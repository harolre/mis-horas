import { db } from '../../db/db';
import { binaryToBlob } from '../../db/binary';
import { isValidISODate } from '../../domain/date';
import type { Attachment } from '../../types';
import { APP_VERSION } from '../../version';
import {
  CHUNK_SIZE,
  BackupError,
  type BackupOptions,
} from '../format';
import { assertCryptoAvailable } from '../crypto';
import {
  openV2Container,
  readV2Meta,
  readV2PayloadRange,
  writeV2Container,
} from './container';
import {
  ATTACHMENTS_EXTENSION,
  V2_FORMAT,
  V2_VERSION,
  isAttachmentsBackupMeta,
  type AttachmentArchiveEntry,
  type AttachmentsBackupMeta,
} from './format';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertYear(year: string): void {
  if (!/^\d{4}$/.test(year)) {
    throw new BackupError('El año de los adjuntos no es válido.');
  }
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

async function hashBlob(blob: Blob): Promise<string> {
  return hashBytes(await blob.arrayBuffer());
}

export function attachmentsBackupFileName(year: string): string {
  assertYear(year);
  return `mis-horas-adjuntos-${year}${ATTACHMENTS_EXTENSION}`;
}

export async function createAttachmentsBackup(
  year: string,
  password: string,
  options: BackupOptions = {},
): Promise<Blob> {
  assertYear(year);
  assertCryptoAvailable();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const attachments = (
    await db.attachments.where('date').between(from, to, true, true).toArray()
  ).sort((a, b) => a.createdAt - b.createdAt);

  const progress = options.onProgress ?? (() => undefined);
  const mains: Blob[] = [];
  const thumbParts: Array<Blob | null> = [];
  const entries: AttachmentArchiveEntry[] = [];
  let mainOffset = 0;

  for (const [index, attachment] of attachments.entries()) {
    if (options.signal?.aborted) {
      throw new DOMException('Cancelado', 'AbortError');
    }
    const stored = await db.attachmentFiles.get(attachment.id);
    const blob = stored
      ? binaryToBlob(stored.blob, attachment.mime)
      : null;
    if (!blob) continue;
    const thumb = binaryToBlob(attachment.thumb, 'image/jpeg');
    progress({
      phase: 'reading',
      completed: index + 1,
      total: attachments.length,
      percent: (index + 1) / Math.max(1, attachments.length),
      detail: attachment.name,
    });
    const [sha256, thumbSha256] = await Promise.all([
      hashBlob(blob),
      thumb ? hashBlob(thumb) : Promise.resolve(null),
    ]);
    entries.push({
      id: attachment.id,
      date: attachment.date,
      name: attachment.name,
      mime: attachment.mime,
      size: blob.size,
      createdAt: attachment.createdAt,
      year,
      offset: mainOffset,
      length: blob.size,
      thumbOffset: null,
      thumbLength: null,
      sha256,
      thumbSha256,
    });
    mains.push(blob);
    thumbParts.push(thumb);
    mainOffset += blob.size;
  }

  if (entries.length === 0) {
    throw new BackupError('No hay adjuntos disponibles para ese año.');
  }

  const thumbs = thumbParts.filter((thumb): thumb is Blob => Boolean(thumb));
  let thumbOffset = mainOffset;
  for (const [index, entry] of entries.entries()) {
    const thumb = thumbParts[index];
    if (!thumb) continue;
    entry.thumbOffset = thumbOffset;
    entry.thumbLength = thumb.size;
    thumbOffset += thumb.size;
  }

  const createdAt = new Date().toISOString();
  const meta: AttachmentsBackupMeta = {
    format: V2_FORMAT,
    version: V2_VERSION,
    kind: 'attachments',
    createdAt,
    appVersion: APP_VERSION,
    year,
    entries,
  };
  const metaBytes = encoder.encode(JSON.stringify(meta));
  const payloadParts = [...mains, ...thumbs];
  const payloadSize = payloadParts.reduce(
    (total, part) => total + part.size,
    0,
  );

  return writeV2Container({
    kind: 'attachments',
    createdAt,
    appVersion: APP_VERSION,
    metaBytes,
    payloadParts,
    payloadSize,
    password,
    iterations: options.iterations,
    chunkSize: options.chunkSize ?? CHUNK_SIZE,
    signal: options.signal,
    onProgress: options.onProgress,
  });
}

function validateEntries(
  entries: AttachmentArchiveEntry[],
  payloadSize: number,
  year: string,
): AttachmentArchiveEntry[] {
  return entries.map((entry) => {
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !isValidISODate(entry.date) ||
      typeof entry.name !== 'string' ||
      typeof entry.mime !== 'string' ||
      !Number.isInteger(entry.size) ||
      entry.size <= 0 ||
      !Number.isInteger(entry.createdAt) ||
      !Number.isInteger(entry.offset) ||
      !Number.isInteger(entry.length) ||
      entry.offset < 0 ||
      entry.length <= 0 ||
      entry.offset + entry.length > payloadSize ||
      typeof entry.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(entry.sha256) ||
      entry.date.slice(0, 4) !== year
    ) {
      throw new BackupError('Hay una foto no válida en la copia de adjuntos.');
    }
    const hasThumb =
      entry.thumbOffset !== null || entry.thumbLength !== null;
    if (
      hasThumb &&
      (!Number.isInteger(entry.thumbOffset) ||
        !Number.isInteger(entry.thumbLength) ||
        (entry.thumbOffset as number) < 0 ||
        (entry.thumbLength as number) <= 0 ||
        (entry.thumbOffset as number) + (entry.thumbLength as number) >
          payloadSize)
    ) {
      throw new BackupError('La miniatura de una foto está dañada.');
    }
    if (
      entry.thumbSha256 !== null &&
      !/^[0-9a-f]{64}$/i.test(entry.thumbSha256)
    ) {
      throw new BackupError('La miniatura de una foto está dañada.');
    }
    return { ...entry };
  });
}

export interface RestoreAttachmentsResult {
  restored: number;
  total: number;
}

async function refreshDayCounts(dates: Set<string>): Promise<void> {
  if (dates.size === 0) return;
  await db.transaction('rw', db.attachments, db.days, async () => {
    for (const date of dates) {
      const count = await db.attachments.where('date').equals(date).count();
      const day = await db.days.get(date);
      if (day) {
        await db.days.put({
          ...day,
          attachmentCount: count,
          updatedAt: Date.now(),
        });
      } else if (count > 0) {
        await db.days.put({
          date,
          kind: 'work',
          attachmentCount: count,
          updatedAt: Date.now(),
        });
      }
    }
  });
}

export async function restoreAttachmentsBackup(
  blob: Blob,
  password: string,
  options: BackupOptions = {},
): Promise<RestoreAttachmentsResult> {
  const opened = await openV2Container(blob, password, 'attachments');
  const metaBytes = await readV2Meta(blob, opened);
  if (!metaBytes) {
    throw new BackupError('La copia de adjuntos no contiene un índice.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(metaBytes));
  } catch {
    throw new BackupError('El índice de la copia de adjuntos está dañado.');
  }
  if (!isAttachmentsBackupMeta(parsed)) {
    throw new BackupError('El archivo no es una copia de adjuntos válida.');
  }
  const entries = validateEntries(
    parsed.entries,
    opened.header.cipher.plainSize,
    parsed.year,
  );
  const progress = options.onProgress ?? (() => undefined);
  const dates = new Set<string>();
  let restored = 0;

  try {
    for (const [index, entry] of entries.entries()) {
      if (options.signal?.aborted) {
        throw new DOMException('Cancelado', 'AbortError');
      }
      progress({
        phase: 'decrypting',
        completed: index,
        total: entries.length,
        percent: index / entries.length,
        detail: entry.name,
      });
      const main = await readV2PayloadRange(
        blob,
        opened,
        entry.offset,
        entry.length,
      );
      const mainBuffer = main.buffer.slice(
        main.byteOffset,
        main.byteOffset + main.byteLength,
      ) as ArrayBuffer;
      if ((await hashBytes(mainBuffer)) !== entry.sha256) {
        throw new BackupError(
          `La foto «${entry.name}» está dañada y no se puede restaurar.`,
        );
      }

      let thumbBuffer: ArrayBuffer | null = null;
      if (entry.thumbOffset !== null && entry.thumbLength !== null) {
        const thumb = await readV2PayloadRange(
          blob,
          opened,
          entry.thumbOffset,
          entry.thumbLength,
        );
        thumbBuffer = thumb.buffer.slice(
          thumb.byteOffset,
          thumb.byteOffset + thumb.byteLength,
        ) as ArrayBuffer;
        if (
          entry.thumbSha256 &&
          (await hashBytes(thumbBuffer)) !== entry.thumbSha256
        ) {
          throw new BackupError(
            `La miniatura de «${entry.name}» está dañada.`,
          );
        }
      }

      const attachment: Attachment = {
        id: entry.id,
        date: entry.date,
        name: entry.name,
        mime: entry.mime,
        size: mainBuffer.byteLength,
        thumb: thumbBuffer,
        createdAt: entry.createdAt,
        archived: 0,
      };
      await db.transaction(
        'rw',
        db.attachmentFiles,
        db.attachments,
        async () => {
          await db.attachmentFiles.put({
            id: entry.id,
            blob: mainBuffer,
          });
          await db.attachments.put(attachment);
        },
      );
      dates.add(entry.date);
      restored += 1;
      progress({
        phase: 'decrypting',
        completed: index + 1,
        total: entries.length,
        percent: (index + 1) / entries.length,
        detail: entry.name,
      });
    }
  } finally {
    await refreshDayCounts(dates);
  }

  progress({
    phase: 'writing',
    completed: 1,
    total: 1,
    percent: 1,
    detail: `${restored} fotos restauradas`,
  });
  return { restored, total: entries.length };
}
