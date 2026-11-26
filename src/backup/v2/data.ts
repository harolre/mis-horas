import { db } from '../../db/db';
import { defaultSettings } from '../../db/defaults';
import { isValidISODate } from '../../domain/date';
import type { Attachment, DayEntry, Settings } from '../../types';
import { APP_VERSION } from '../../version';
import {
  CHUNK_SIZE,
  BackupError,
  type BackupOptions,
  type ProgressInfo,
} from '../format';
import {
  validateAccounts,
  validateDays,
  validateMovements,
  validateSettings,
} from '../validate';
import {
  openV2Container,
  readV2PayloadAll,
  writeV2Container,
} from './container';
import {
  DATA_EXTENSION,
  V2_FORMAT,
  V2_VERSION,
  indexEntryFromAttachment,
  isDataBackupPayload,
  type AttachmentIndexEntry,
  type DataBackupPayload,
} from './format';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function dataBackupFileName(): string {
  return `mis-horas-datos-${new Date().toISOString().slice(0, 10)}${DATA_EXTENSION}`;
}

function validateAttachmentIndex(
  attachments: AttachmentIndexEntry[],
): AttachmentIndexEntry[] {
  return attachments.map((attachment) => {
    if (
      !attachment ||
      typeof attachment.id !== 'string' ||
      !isValidISODate(attachment.date) ||
      typeof attachment.name !== 'string' ||
      typeof attachment.mime !== 'string' ||
      !Number.isInteger(attachment.size) ||
      attachment.size < 0 ||
      !Number.isInteger(attachment.createdAt) ||
      attachment.year !== attachment.date.slice(0, 4)
    ) {
      throw new BackupError('Hay un adjunto no válido en la copia de datos.');
    }
    return { ...attachment };
  });
}

export async function createDataBackup(
  password: string,
  options: BackupOptions = {},
): Promise<Blob> {
  const [accounts, movements, days, settings, attachments] =
    await Promise.all([
      db.accounts.toArray(),
      db.movements.toArray(),
      db.days.toArray(),
      db.settings.get('app'),
      db.attachments.orderBy('createdAt').toArray(),
    ]);

  if (!settings) {
    throw new BackupError('No se encontró la configuración de la app.');
  }

  const createdAt = new Date().toISOString();
  const payload: DataBackupPayload = {
    format: V2_FORMAT,
    version: V2_VERSION,
    kind: 'data',
    createdAt,
    appVersion: APP_VERSION,
    accounts,
    movements,
    days,
    settings,
    attachments: attachments.map(indexEntryFromAttachment),
  };
  const bytes = encoder.encode(JSON.stringify(payload));

  return writeV2Container({
    kind: 'data',
    createdAt,
    appVersion: APP_VERSION,
    metaBytes: new Uint8Array(0),
    payloadParts: [new Blob([bytes])],
    payloadSize: bytes.length,
    password,
    iterations: options.iterations,
    chunkSize: options.chunkSize ?? CHUNK_SIZE,
    signal: options.signal,
    onProgress: options.onProgress,
  });
}

export async function readDataBackup(
  blob: Blob,
  password: string,
  options: BackupOptions = {},
): Promise<DataBackupPayload> {
  const opened = await openV2Container(blob, password, 'data');
  const bytes = await readV2PayloadAll(blob, opened, options.onProgress);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new BackupError('El contenido de la copia de datos está dañado.');
  }
  if (!isDataBackupPayload(parsed)) {
    throw new BackupError('El archivo no es una copia de datos válida.');
  }
  const accounts = validateAccounts(parsed.accounts);
  const accountIds = new Set(accounts.map((account) => account.id));
  const movements = validateMovements(parsed.movements, accountIds);
  const days = validateDays(parsed.days);
  const settings = validateSettings(parsed.settings);
  const attachments = validateAttachmentIndex(parsed.attachments);

  return {
    ...parsed,
    accounts,
    movements,
    days,
    settings,
    attachments,
  };
}

export interface ApplyDataResult {
  movements: number;
  days: number;
  attachments: number;
  archived: number;
}

export async function applyDataBackup(
  payload: DataBackupPayload,
  onProgress?: (progress: ProgressInfo) => void,
): Promise<ApplyDataResult> {
  const progress = onProgress ?? (() => undefined);
  const counts = new Map<string, number>();
  for (const attachment of payload.attachments) {
    counts.set(
      attachment.date,
      (counts.get(attachment.date) ?? 0) + 1,
    );
  }

  const existingFiles = new Set<string>(
    await db.attachmentFiles.toCollection().primaryKeys(),
  );
  const existingAttachments = await db.attachments.toArray();
  const existingThumbs = new Map(
    existingAttachments.map((attachment) => [
      attachment.id,
      attachment.thumb,
    ]),
  );

  const attachments: Attachment[] = payload.attachments.map(
    (attachment) => ({
      id: attachment.id,
      date: attachment.date,
      name: attachment.name,
      mime: attachment.mime,
      size: attachment.size,
      thumb: existingThumbs.get(attachment.id) ?? null,
      createdAt: attachment.createdAt,
      archived: existingFiles.has(attachment.id) ? 0 : 1,
    }),
  );
  const archived = attachments.filter(
    (attachment) => attachment.archived === 1,
  ).length;

  const dayMap = new Map<string, DayEntry>();
  for (const day of payload.days) {
    dayMap.set(day.date, { ...day });
  }
  for (const attachment of attachments) {
    if (!dayMap.has(attachment.date)) {
      dayMap.set(attachment.date, {
        date: attachment.date,
        kind: 'work',
        attachmentCount: 0,
        updatedAt: Date.now(),
      });
    }
  }
  const days = Array.from(dayMap.values()).map((day) => ({
    ...day,
    attachmentCount: counts.get(day.date) ?? 0,
    updatedAt: day.updatedAt ?? Date.now(),
  }));

  const settings: Settings = {
    ...defaultSettings(),
    ...payload.settings,
    id: 'app',
    updatedAt: Date.now(),
  };

  progress({
    phase: 'writing',
    completed: 0,
    total: 1,
    percent: 0,
    detail: `${payload.attachments.length} adjuntos referenciados`,
  });
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.movements,
      db.days,
      db.attachments,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.movements.clear(),
        db.days.clear(),
        db.attachments.clear(),
        db.settings.clear(),
      ]);
      await db.accounts.bulkPut(payload.accounts);
      await db.movements.bulkPut(payload.movements);
      await db.days.bulkPut(days);
      await db.settings.put(settings);
      await db.attachments.bulkPut(attachments);
    },
  );
  progress({
    phase: 'writing',
    completed: 1,
    total: 1,
    percent: 1,
    detail: 'Datos restaurados',
  });

  return {
    movements: payload.movements.length,
    days: days.length,
    attachments: attachments.length,
    archived,
  };
}
