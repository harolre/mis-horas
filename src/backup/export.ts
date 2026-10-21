import { db } from '../db/db';
import type { Attachment } from '../types';
import { APP_VERSION } from '../version';
import { todayISO } from '../domain/date';
import {
  assertCryptoAvailable,
  deriveKey,
  encryptChunk,
  makeAad,
  makeIv,
  randomBytes,
} from './crypto';
import {
  BACKUP_FORMAT,
  BACKUP_MAGIC,
  BACKUP_VERSION,
  BackupError,
  CHUNK_SIZE,
  KDF_ITERATIONS,
  bytesToBase64,
  uint32BE,
  type BackupAttachmentMeta,
  type BackupMeta,
  type BackupOptions,
  type EncryptedHeader,
} from './format';

const encoder = new TextEncoder();

export function backupFileName(): string {
  return `mis-horas-${todayISO()}.mhbackup`;
}

export async function createBackup(
  password: string,
  options: BackupOptions = {},
): Promise<Blob> {
  if (password.length < 8) {
    throw new BackupError('La contraseña debe tener al menos 8 caracteres.');
  }
  assertCryptoAvailable();
  if (options.signal?.aborted) {
    throw new DOMException('Cancelado', 'AbortError');
  }

  const iterations = options.iterations ?? KDF_ITERATIONS;
  const chunkSize = options.chunkSize ?? CHUNK_SIZE;
  const progress = options.onProgress ?? (() => undefined);

  progress({ phase: 'reading', completed: 0, total: 1, percent: 0 });
  const [accounts, movements, days, settings, attachments, files] =
    await Promise.all([
      db.accounts.toArray(),
      db.movements.toArray(),
      db.days.toArray(),
      db.settings.get('app'),
      db.attachments.orderBy('createdAt').toArray(),
      db.attachmentFiles.toArray(),
    ]);

  if (!settings) {
    throw new BackupError('No se encontró la configuración de la app.');
  }

  const fileMap = new Map(files.map((file) => [file.id, file.blob]));
  const usableAttachments: Attachment[] = [];
  const dataParts: BlobPart[] = [];

  let mainOffset = 0;
  const attachmentMeta: BackupAttachmentMeta[] = [];

  for (const attachment of attachments) {
    const blob = fileMap.get(attachment.id);
    if (!blob) continue;
    attachmentMeta.push({
      id: attachment.id,
      date: attachment.date,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      createdAt: attachment.createdAt,
      offset: mainOffset,
      length: blob.size,
      thumbOffset: null,
      thumbLength: null,
    });
    dataParts.push(blob);
    mainOffset += blob.size;
    usableAttachments.push(attachment);
  }

  let thumbOffset = mainOffset;
  for (const attachment of usableAttachments) {
    const thumb = attachment.thumb;
    const meta = attachmentMeta.find((item) => item.id === attachment.id);
    if (!meta) continue;
    if (thumb) {
      meta.thumbOffset = thumbOffset;
      meta.thumbLength = thumb.size;
      dataParts.push(thumb);
      thumbOffset += thumb.size;
    }
  }

  const usedAttachmentIds = new Set(attachmentMeta.map((item) => item.id));
  const cleanDays = days.map((day) => ({
    ...day,
    attachmentCount: attachmentMeta.filter((item) => item.date === day.date).length,
  }));

  const meta: BackupMeta = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    accounts,
    movements,
    days: cleanDays,
    settings,
    attachments: attachmentMeta.filter((item) => usedAttachmentIds.has(item.id)),
  };

  const metaBytes = encoder.encode(JSON.stringify(meta));
  const plaintext = new Blob([uint32BE(metaBytes.length), metaBytes, ...dataParts]);
  const plainSize = plaintext.size;
  const chunkCount = Math.max(1, Math.ceil(plainSize / chunkSize));

  progress({ phase: 'reading', completed: 1, total: 1, percent: 1 });

  const salt = randomBytes(16);
  const ivPrefix = randomBytes(8);
  const key = await deriveKey(password, salt, iterations);

  const header: EncryptedHeader = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: meta.createdAt,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-GCM',
      ivPrefix: bytesToBase64(ivPrefix),
      chunkSize,
      chunkCount,
      plainSize,
    },
  };

  const headerBytes = encoder.encode(JSON.stringify(header));
  const parts: BlobPart[] = [
    encoder.encode(BACKUP_MAGIC),
    uint32BE(headerBytes.length),
    headerBytes,
  ];

  for (let index = 0; index < chunkCount; index += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Cancelado', 'AbortError');
    }
    const start = index * chunkSize;
    const chunk = new Uint8Array(
      await plaintext.slice(start, Math.min(start + chunkSize, plainSize)).arrayBuffer(),
    );
    const ciphertext = await encryptChunk(
      key,
      chunk,
      makeIv(ivPrefix, index),
      makeAad(BACKUP_MAGIC, index, chunkCount),
    );
    parts.push(uint32BE(ciphertext.length), ciphertext);
    progress({
      phase: 'encrypting',
      completed: index + 1,
      total: chunkCount,
      percent: (index + 1) / chunkCount,
    });
  }

  return new Blob(parts, { type: 'application/octet-stream' });
}
