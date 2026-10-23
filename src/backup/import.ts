import { db } from '../db/db';
import { binaryToArrayBuffer } from '../db/binary';
import { defaultAccount, defaultSettings } from '../db/defaults';
import { isValidISODate } from '../domain/date';
import type {
  Account,
  Attachment,
  AttachmentFile,
  DayEntry,
  Movement,
  Settings,
} from '../types';
import { assertCryptoAvailable, decryptChunk, deriveKey, makeAad, makeIv } from './crypto';
import {
  BACKUP_FORMAT,
  BACKUP_MAGIC,
  BACKUP_VERSION,
  BackupError,
  base64ToBytes,
  isBackupMeta,
  readUint32,
  type BackupOptions,
  type EncryptedHeader,
  type ParsedBackup,
} from './format';

const decoder = new TextDecoder();
const MAX_META_SIZE = 50 * 1024 * 1024;

async function readBytes(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

function parseHeader(bytes: Uint8Array): EncryptedHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new BackupError('La cabecera de la copia no es válida.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new BackupError('La cabecera de la copia no es válida.');
  }
  const header = parsed as Partial<EncryptedHeader>;
  if (header.format !== BACKUP_FORMAT || header.version !== BACKUP_VERSION) {
    throw new BackupError('La copia pertenece a otra versión de la app.');
  }
  if (!header.kdf || header.kdf.name !== 'PBKDF2' || header.kdf.hash !== 'SHA-256') {
    throw new BackupError('El método de cifrado de la copia no es compatible.');
  }
  if (!header.cipher || header.cipher.name !== 'AES-GCM') {
    throw new BackupError('El cifrado de la copia no es compatible.');
  }
  if (
    !Number.isInteger(header.kdf.iterations) ||
    header.kdf.iterations < 1_000 ||
    header.kdf.iterations > 2_000_000
  ) {
    throw new BackupError('El número de iteraciones de la copia no es válido.');
  }
  if (
    !Number.isInteger(header.cipher.chunkCount) ||
    header.cipher.chunkCount < 1 ||
    header.cipher.chunkCount > 100_000 ||
    !Number.isInteger(header.cipher.chunkSize) ||
    header.cipher.chunkSize < 1024 ||
    header.cipher.chunkSize > 32 * 1024 * 1024
  ) {
    throw new BackupError('La estructura de bloques de la copia no es válida.');
  }
  if (
    !Number.isFinite(header.cipher.plainSize) ||
    header.cipher.plainSize < 0
  ) {
    throw new BackupError('El tamaño de la copia no es válido.');
  }
  if (typeof header.kdf.salt !== 'string' || typeof header.cipher.ivPrefix !== 'string') {
    throw new BackupError('Faltan datos de cifrado en la copia.');
  }
  return header as EncryptedHeader;
}

function validateSettings(settings: Settings): Settings {
  if (
    !settings ||
    settings.weekStart < 1 ||
    settings.weekStart > 7 ||
    !Array.isArray(settings.dailyTargets) ||
    settings.dailyTargets.length !== 7 ||
    settings.dailyTargets.some(
      (minutes) => !Number.isFinite(minutes) || minutes < 0 || minutes > 1440,
    )
  ) {
    throw new BackupError('La configuración incluida en la copia no es válida.');
  }
  return { ...settings, id: 'app' };
}

function validateMovements(movements: Movement[], accountIds: Set<string>): Movement[] {
  for (const movement of movements) {
    if (
      !movement ||
      typeof movement.id !== 'string' ||
      typeof movement.accountId !== 'string' ||
      !isValidISODate(movement.date) ||
      !Number.isInteger(movement.startMin) ||
      !Number.isInteger(movement.endMin) ||
      !Number.isInteger(movement.breakMin) ||
      movement.startMin < 0 ||
      movement.startMin > 1439 ||
      movement.endMin < 0 ||
      movement.endMin > 1439 ||
      movement.breakMin < 0
    ) {
      throw new BackupError('Hay un movimiento no válido en la copia.');
    }
    if (!accountIds.has(movement.accountId)) {
      throw new BackupError('Un movimiento apunta a una cuenta inexistente.');
    }
  }
  return movements;
}

function validateAccounts(accounts: Account[]): Account[] {
  const result = accounts.map((account) => {
    if (
      !account ||
      typeof account.id !== 'string' ||
      typeof account.name !== 'string' ||
      !account.name.trim() ||
      typeof account.color !== 'string'
    ) {
      throw new BackupError('Hay una cuenta no válida en la copia.');
    }
    return { ...account, archived: (account.archived ? 1 : 0) as 0 | 1 };
  });
  if (result.length === 0) {
    result.push(defaultAccount());
  }
  if (!result.some((account) => !account.archived)) {
    result[0] = { ...result[0], archived: 0 };
  }
  return result;
}

export async function readBackup(
  blob: Blob,
  password: string,
  options: BackupOptions = {},
): Promise<ParsedBackup> {
  assertCryptoAvailable();
  if (password.length === 0) {
    throw new BackupError('Introduce la contraseña de la copia.');
  }
  if (blob.size < 9) {
    throw new BackupError('El archivo no es una copia de Mis Horas.');
  }
  const progress = options.onProgress ?? (() => undefined);

  const magic = decoder.decode(await readBytes(blob, 0, 5));
  if (magic !== BACKUP_MAGIC) {
    throw new BackupError('El archivo no es una copia de Mis Horas.');
  }

  const headerLengthBytes = await readBytes(blob, 5, 4);
  const headerLength = readUint32(new DataView(headerLengthBytes.buffer), 0);
  if (headerLength <= 0 || headerLength > 1024 * 1024 || 9 + headerLength > blob.size) {
    throw new BackupError('La cabecera de la copia está dañada.');
  }
  const headerBytes = await readBytes(blob, 9, headerLength);
  const header = parseHeader(headerBytes);

  const salt = base64ToBytes(header.kdf.salt);
  const ivPrefix = base64ToBytes(header.cipher.ivPrefix);
  if (salt.length !== 16 || ivPrefix.length !== 8) {
    throw new BackupError('Los datos de cifrado de la copia están dañados.');
  }

  const key = await deriveKey(password, salt, header.kdf.iterations);
  const { chunkCount, chunkSize, plainSize } = header.cipher;
  const expectedChunks = Math.max(1, Math.ceil(plainSize / chunkSize));
  if (chunkCount !== expectedChunks) {
    throw new BackupError('El tamaño de la copia no coincide con su cabecera.');
  }

  let offset = 9 + headerLength;
  const plainParts: BlobPart[] = [];
  let decryptedSize = 0;

  for (let index = 0; index < chunkCount; index += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Cancelado', 'AbortError');
    }
    if (offset + 4 > blob.size) {
      throw new BackupError('La copia está incompleta.');
    }
    const lengthBytes = await readBytes(blob, offset, 4);
    offset += 4;
    const cipherLength = readUint32(new DataView(lengthBytes.buffer), 0);
    if (cipherLength <= 16 || cipherLength > chunkSize + 16) {
      throw new BackupError('La copia contiene un bloque no válido.');
    }
    if (offset + cipherLength > blob.size) {
      throw new BackupError('La copia está incompleta.');
    }
    const ciphertext = await readBytes(blob, offset, cipherLength);
    offset += cipherLength;
    const plain = await decryptChunk(
      key,
      ciphertext,
      makeIv(ivPrefix, index),
      makeAad(BACKUP_MAGIC, index, chunkCount),
    );
    if (plain.length > chunkSize) {
      throw new BackupError('La copia contiene un bloque demasiado grande.');
    }
    const copy = new Uint8Array(plain.length);
    copy.set(plain);
    plainParts.push(copy);
    decryptedSize += plain.length;
    progress({
      phase: 'decrypting',
      completed: index + 1,
      total: chunkCount,
      percent: (index + 1) / chunkCount,
    });
  }

  if (offset !== blob.size) {
    throw new BackupError('La copia contiene datos sobrantes o está dañada.');
  }
  if (decryptedSize !== plainSize) {
    throw new BackupError('El contenido descifrado no coincide con su tamaño.');
  }

  const plaintext = new Blob(plainParts);
  if (plaintext.size < 4) {
    throw new BackupError('La copia no contiene datos.');
  }
  const metaLengthBytes = await readBytes(plaintext, 0, 4);
  const metaLength = readUint32(new DataView(metaLengthBytes.buffer), 0);
  if (metaLength <= 0 || metaLength > MAX_META_SIZE || 4 + metaLength > plaintext.size) {
    throw new BackupError('Los metadatos de la copia están dañados.');
  }
  const metaBytes = await readBytes(plaintext, 4, metaLength);
  let metaUnknown: unknown;
  try {
    metaUnknown = JSON.parse(decoder.decode(metaBytes));
  } catch {
    throw new BackupError('Los metadatos de la copia están dañados.');
  }
  if (!isBackupMeta(metaUnknown) || metaUnknown.version !== BACKUP_VERSION) {
    throw new BackupError('La copia pertenece a otra versión de la app.');
  }
  const meta = metaUnknown;
  const accounts = validateAccounts(meta.accounts);
  const accountIds = new Set(accounts.map((account) => account.id));
  const movements = validateMovements(meta.movements, accountIds);
  const settings = validateSettings(meta.settings);

  const dataStart = 4 + metaLength;
  const dataSize = plaintext.size - dataStart;
  const data = plaintext.slice(dataStart);
  const attachments: Attachment[] = [];
  const files: AttachmentFile[] = [];

  for (const attachment of meta.attachments) {
    if (
      !attachment ||
      typeof attachment.id !== 'string' ||
      typeof attachment.date !== 'string' ||
      !isValidISODate(attachment.date) ||
      typeof attachment.name !== 'string' ||
      typeof attachment.mime !== 'string' ||
      !Number.isInteger(attachment.offset) ||
      !Number.isInteger(attachment.length) ||
      attachment.offset < 0 ||
      attachment.length <= 0 ||
      attachment.offset + attachment.length > dataSize
    ) {
      throw new BackupError('Hay un adjunto no válido en la copia.');
    }
    let thumb: Blob | null = null;
    if (attachment.thumbOffset !== null && attachment.thumbLength !== null) {
      if (
        !Number.isInteger(attachment.thumbOffset) ||
        !Number.isInteger(attachment.thumbLength) ||
        attachment.thumbOffset < 0 ||
        attachment.thumbLength <= 0 ||
        attachment.thumbOffset + attachment.thumbLength > dataSize
      ) {
        throw new BackupError('La miniatura de un adjunto está dañada.');
      }
      thumb = data.slice(
        attachment.thumbOffset,
        attachment.thumbOffset + attachment.thumbLength,
        'image/jpeg',
      );
    }
    const blob = data.slice(
      attachment.offset,
      attachment.offset + attachment.length,
      attachment.mime,
    );
    attachments.push({
      id: attachment.id,
      date: attachment.date,
      name: attachment.name,
      mime: attachment.mime,
      size: blob.size,
      thumb,
      createdAt: attachment.createdAt,
    });
    files.push({ id: attachment.id, blob });
  }

  const days = meta.days
    .filter(
      (day): day is DayEntry =>
        Boolean(day) && typeof day.date === 'string' && isValidISODate(day.date),
    )
    .map((day) => ({ ...day }));

  return {
    meta: {
      ...meta,
      accounts,
      movements,
      days,
      settings,
    },
    attachments,
    files,
  };
}

export async function applyBackup(
  parsed: ParsedBackup,
  onProgress?: BackupOptions['onProgress'],
): Promise<void> {
  const progress = onProgress ?? (() => undefined);
  const { meta, attachments, files } = parsed;
  const counts = new Map<string, number>();
  for (const attachment of attachments) {
    counts.set(attachment.date, (counts.get(attachment.date) ?? 0) + 1);
  }
  const dayMap = new Map<string, DayEntry>();
  for (const day of meta.days) {
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
    ...meta.settings,
    id: 'app',
    updatedAt: Date.now(),
  };

  const [storedAttachments, storedFiles] = await Promise.all([
    Promise.all(
      attachments.map(async (attachment) => ({
        ...attachment,
        thumb: await binaryToArrayBuffer(attachment.thumb),
      })),
    ),
    Promise.all(
      files.map(async (file) => ({
        ...file,
        blob: file.blob instanceof Blob ? await file.blob.arrayBuffer() : file.blob,
      })),
    ),
  ]);

  progress({ phase: 'writing', completed: 0, total: 1, percent: 0 });
  await db.transaction(
    'rw',
    [
      db.accounts,
      db.movements,
      db.days,
      db.attachments,
      db.attachmentFiles,
      db.settings,
    ],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.movements.clear(),
        db.days.clear(),
        db.attachments.clear(),
        db.attachmentFiles.clear(),
        db.settings.clear(),
      ]);
      await db.accounts.bulkPut(meta.accounts);
      await db.movements.bulkPut(meta.movements);
      await db.days.bulkPut(days);
      await db.settings.put(settings);
      await db.attachments.bulkPut(storedAttachments);
      await db.attachmentFiles.bulkPut(storedFiles);
    },
  );
  progress({ phase: 'writing', completed: 1, total: 1, percent: 1 });
}
