import {
  assertCryptoAvailable,
  decryptChunk,
  deriveKey,
  encryptChunk,
  makeAad,
  makeIv,
  randomBytes,
} from '../crypto';
import {
  BackupError,
  base64ToBytes,
  bytesToBase64,
  readUint32,
  uint32BE,
  type ProgressInfo,
} from '../format';
import { KDF_ITERATIONS } from '../format';
import {
  V2_FORMAT,
  V2_MAGIC,
  V2_VERSION,
  type OpenedV2Container,
  type V2Header,
  type V2Kind,
} from './format';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_HEADER_SIZE = 1024 * 1024;
const MAX_META_SIZE = 50 * 1024 * 1024;

export interface WriteV2Options {
  kind: V2Kind;
  createdAt: string;
  appVersion: string;
  metaBytes: Uint8Array;
  payloadParts: Blob[];
  payloadSize: number;
  password: string;
  iterations?: number;
  chunkSize: number;
  signal?: AbortSignal;
  onProgress?: (progress: ProgressInfo) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
}

async function readBytes(
  blob: Blob,
  start: number,
  length: number,
): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

function partReader(parts: Blob[]): {
  read: (start: number, length: number) => Promise<Uint8Array>;
} {
  const starts: number[] = [];
  let cursor = 0;
  for (const part of parts) {
    starts.push(cursor);
    cursor += part.size;
  }

  async function read(start: number, length: number): Promise<Uint8Array> {
    if (length === 0) return new Uint8Array(0);
    const result = new Uint8Array(length);
    let written = 0;
    let index = starts.length - 1;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i] + parts[i].size > start) {
        index = i;
        break;
      }
    }
    let offset = start;
    while (written < length && index < parts.length) {
      const partStart = starts[index];
      const localStart = Math.max(0, offset - partStart);
      const available = Math.min(
        parts[index].size - localStart,
        length - written,
      );
      if (available <= 0) {
        index += 1;
        continue;
      }
      const bytes = new Uint8Array(
        await parts[index]
          .slice(localStart, localStart + available)
          .arrayBuffer(),
      );
      result.set(bytes, written);
      written += available;
      offset += available;
      index += 1;
    }
    if (written !== length) {
      throw new BackupError('No se pudo preparar el contenido de la copia.');
    }
    return result;
  }

  return { read };
}

function validateHeader(value: unknown): V2Header {
  if (!value || typeof value !== 'object') {
    throw new BackupError('La cabecera de la copia no es válida.');
  }
  const header = value as Partial<V2Header>;
  if (
    header.format !== V2_FORMAT ||
    header.version !== V2_VERSION ||
    (header.kind !== 'data' && header.kind !== 'attachments')
  ) {
    throw new BackupError('La copia pertenece a otra versión de la app.');
  }
  if (
    !header.kdf ||
    header.kdf.name !== 'PBKDF2' ||
    header.kdf.hash !== 'SHA-256' ||
    !Number.isInteger(header.kdf.iterations) ||
    header.kdf.iterations < 1_000 ||
    header.kdf.iterations > 2_000_000 ||
    typeof header.kdf.salt !== 'string'
  ) {
    throw new BackupError('El cifrado de la copia no es válido.');
  }
  if (
    !header.cipher ||
    header.cipher.name !== 'AES-GCM' ||
    typeof header.cipher.ivPrefix !== 'string' ||
    !Number.isInteger(header.cipher.chunkSize) ||
    header.cipher.chunkSize < 16 * 1024 ||
    header.cipher.chunkSize > 8 * 1024 * 1024 ||
    !Number.isInteger(header.cipher.chunkCount) ||
    header.cipher.chunkCount < 1 ||
    header.cipher.chunkCount > 100_000 ||
    !Number.isInteger(header.cipher.plainSize) ||
    header.cipher.plainSize < 0 ||
    !Number.isInteger(header.cipher.metaSize) ||
    header.cipher.metaSize < 0 ||
    header.cipher.metaSize > MAX_META_SIZE ||
    !Number.isInteger(header.cipher.metaCipherLength) ||
    header.cipher.metaCipherLength < 0 ||
    header.cipher.metaCipherLength > MAX_META_SIZE + 16
  ) {
    throw new BackupError('La estructura de la copia no es válida.');
  }
  if (header.cipher.metaSize > 0 && header.cipher.metaCipherLength < 17) {
    throw new BackupError('La estructura de la copia no es válida.');
  }
  const expectedChunks = Math.max(
    1,
    Math.ceil(header.cipher.plainSize / header.cipher.chunkSize),
  );
  if (header.cipher.chunkCount !== expectedChunks) {
    throw new BackupError('El tamaño de la copia no coincide con su cabecera.');
  }
  if (
    typeof header.createdAt !== 'string' ||
    typeof header.appVersion !== 'string'
  ) {
    throw new BackupError('La cabecera de la copia está incompleta.');
  }
  return header as V2Header;
}

export async function writeV2Container(
  options: WriteV2Options,
): Promise<Blob> {
  if (options.password.length < 8) {
    throw new BackupError('La contraseña debe tener al menos 8 caracteres.');
  }
  assertCryptoAvailable();
  throwIfAborted(options.signal);

  const iterations = options.iterations ?? KDF_ITERATIONS;
  const progress = options.onProgress ?? (() => undefined);
  const salt = randomBytes(16);
  const ivPrefix = randomBytes(8);
  const key = await deriveKey(
    options.password,
    salt,
    iterations,
  );

  const metaBytes = options.metaBytes;
  const metaCipher = metaBytes.length
    ? await encryptChunk(
        key,
        metaBytes,
        makeIv(ivPrefix, 0),
        makeAad(`${V2_MAGIC}-meta`, 0, 1),
      )
    : new Uint8Array(0);

  const payloadSize = options.payloadSize;
  const actualPayloadSize = options.payloadParts.reduce(
    (total, part) => total + part.size,
    0,
  );
  if (actualPayloadSize !== payloadSize) {
    throw new BackupError('El contenido de la copia no coincide con su tamaño.');
  }
  if (payloadSize > 4 * 1024 * 1024 * 1024) {
    throw new BackupError(
      'La copia supera el máximo de 4 GB. Divídela por años o periodos.',
    );
  }
  const chunkCount = Math.max(
    1,
    Math.ceil(payloadSize / options.chunkSize),
  );
  const header: V2Header = {
    format: V2_FORMAT,
    version: V2_VERSION,
    kind: options.kind,
    createdAt: options.createdAt,
    appVersion: options.appVersion,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-GCM',
      ivPrefix: bytesToBase64(ivPrefix),
      chunkSize: options.chunkSize,
      chunkCount,
      plainSize: payloadSize,
      metaSize: metaBytes.length,
      metaCipherLength: metaCipher.length,
    },
  };

  const headerBytes = encoder.encode(JSON.stringify(header));
  const parts: BlobPart[] = [
    encoder.encode(V2_MAGIC),
    uint32BE(headerBytes.length),
    headerBytes,
    uint32BE(metaCipher.length),
    metaCipher,
  ];

  const reader = partReader(options.payloadParts);
  for (let index = 0; index < chunkCount; index += 1) {
    throwIfAborted(options.signal);
    const start = index * options.chunkSize;
    const length = Math.min(
      options.chunkSize,
      Math.max(0, payloadSize - start),
    );
    const plain = await reader.read(start, length);
    const ciphertext = await encryptChunk(
      key,
      plain,
      makeIv(ivPrefix, index + 1),
      makeAad(`${V2_MAGIC}-payload`, index, chunkCount),
    );
    parts.push(uint32BE(ciphertext.length), ciphertext);
    progress({
      phase: 'encrypting',
      completed: index + 1,
      total: chunkCount,
      percent: (index + 1) / chunkCount,
      detail: `${index + 1} de ${chunkCount} bloques`,
    });
  }

  return new Blob(parts, { type: 'application/octet-stream' });
}

export async function openV2Container(
  blob: Blob,
  password: string,
  expectedKind: V2Kind,
): Promise<OpenedV2Container> {
  assertCryptoAvailable();
  if (password.length === 0) {
    throw new BackupError('Introduce la contraseña de la copia.');
  }
  if (blob.size < 9) {
    throw new BackupError('El archivo no es una copia de Mis Horas.');
  }
  const magic = decoder.decode(await readBytes(blob, 0, 5));
  if (magic !== V2_MAGIC) {
    throw new BackupError('El archivo no es una copia de Mis Horas.');
  }
  const headerLengthBytes = await readBytes(blob, 5, 4);
  const headerLength = readUint32(
    new DataView(headerLengthBytes.buffer),
    0,
  );
  if (
    headerLength <= 0 ||
    headerLength > MAX_HEADER_SIZE ||
    9 + headerLength > blob.size
  ) {
    throw new BackupError('La cabecera de la copia está dañada.');
  }
  const headerBytes = await readBytes(blob, 9, headerLength);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(headerBytes));
  } catch {
    throw new BackupError('La cabecera de la copia no es válida.');
  }
  const header = validateHeader(parsed);
  if (header.kind !== expectedKind) {
    throw new BackupError(
      expectedKind === 'data'
        ? 'Este archivo contiene fotos, no datos.'
        : 'Este archivo contiene datos, no fotos.',
    );
  }

  let saltBytes: Uint8Array;
  let ivPrefixBytes: Uint8Array;
  try {
    saltBytes = base64ToBytes(header.kdf.salt);
    ivPrefixBytes = base64ToBytes(header.cipher.ivPrefix);
  } catch {
    throw new BackupError('Los datos de cifrado están dañados.');
  }
  if (saltBytes.length !== 16 || ivPrefixBytes.length !== 8) {
    throw new BackupError('Los datos de cifrado están dañados.');
  }

  const bodyStart = 9 + headerLength;
  if (bodyStart + 4 > blob.size) {
    throw new BackupError('La copia está incompleta.');
  }
  const metaLengthBytes = await readBytes(blob, bodyStart, 4);
  const metaCipherLength = readUint32(
    new DataView(metaLengthBytes.buffer),
    0,
  );
  if (metaCipherLength !== header.cipher.metaCipherLength) {
    throw new BackupError('La cabecera de la copia no coincide.');
  }
  const metaStart = bodyStart + 4;
  const payloadStart = metaStart + metaCipherLength;
  const expectedSize =
    payloadStart +
    header.cipher.chunkCount * 4 +
    header.cipher.plainSize +
    header.cipher.chunkCount * 16;
  if (blob.size !== expectedSize) {
    throw new BackupError(
      blob.size < expectedSize
        ? 'La copia está incompleta.'
        : 'La copia contiene datos sobrantes o está dañada.',
    );
  }

  const key = await deriveKey(
    password,
    saltBytes,
    header.kdf.iterations,
  );
  return { header, key, metaStart, payloadStart };
}

export async function readV2Meta(
  blob: Blob,
  opened: OpenedV2Container,
): Promise<Uint8Array | null> {
  const { header, key, metaStart } = opened;
  if (header.cipher.metaCipherLength === 0) return null;
  const metaCipher = await readBytes(
    blob,
    metaStart,
    header.cipher.metaCipherLength,
  );
  const plain = await decryptChunk(
    key,
    metaCipher,
    makeIv(base64ToBytes(header.cipher.ivPrefix), 0),
    makeAad(`${V2_MAGIC}-meta`, 0, 1),
  );
  if (plain.length !== header.cipher.metaSize) {
    throw new BackupError('El índice de la copia está dañado.');
  }
  return plain;
}

function chunkLength(header: V2Header, index: number): number {
  const start = index * header.cipher.chunkSize;
  return Math.min(
    header.cipher.chunkSize,
    Math.max(0, header.cipher.plainSize - start),
  );
}

function chunkOffset(opened: OpenedV2Container, index: number): number {
  const full = 4 + opened.header.cipher.chunkSize + 16;
  return opened.payloadStart + index * full;
}

export async function readV2PayloadRange(
  blob: Blob,
  opened: OpenedV2Container,
  start: number,
  length: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<Uint8Array> {
  const { header, key } = opened;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(length) ||
    start < 0 ||
    length < 0 ||
    start + length > header.cipher.plainSize
  ) {
    throw new BackupError('El rango solicitado no es válido.');
  }
  if (length === 0) return new Uint8Array(0);

  const firstChunk = Math.floor(start / header.cipher.chunkSize);
  const lastChunk = Math.floor(
    (start + length - 1) / header.cipher.chunkSize,
  );
  const result = new Uint8Array(length);
  let written = 0;
  const ivPrefix = Uint8Array.from(
    atob(header.cipher.ivPrefix),
    (character) => character.charCodeAt(0),
  );

  for (let index = firstChunk; index <= lastChunk; index += 1) {
    const offset = chunkOffset(opened, index);
    if (offset + 4 > blob.size) {
      throw new BackupError('La copia está incompleta.');
    }
    const lengthBytes = await readBytes(blob, offset, 4);
    const cipherLength = readUint32(
      new DataView(lengthBytes.buffer),
      0,
    );
    const expectedCipherLength = chunkLength(header, index) + 16;
    if (cipherLength !== expectedCipherLength) {
      throw new BackupError('La copia contiene un bloque no válido.');
    }
    const ciphertext = await readBytes(blob, offset + 4, cipherLength);
    const plain = await decryptChunk(
      key,
      ciphertext,
      makeIv(ivPrefix, index + 1),
      makeAad(
        `${V2_MAGIC}-payload`,
        index,
        header.cipher.chunkCount,
      ),
    );
    if (plain.length !== chunkLength(header, index)) {
      throw new BackupError('La copia contiene un bloque no válido.');
    }
    const chunkStart = index * header.cipher.chunkSize;
    const from = Math.max(start, chunkStart);
    const to = Math.min(
      start + length,
      chunkStart + plain.length,
    );
    result.set(
      plain.subarray(from - chunkStart, to - chunkStart),
      written,
    );
    written += to - from;
    onProgress?.(
      index - firstChunk + 1,
      lastChunk - firstChunk + 1,
    );
  }

  if (written !== length) {
    throw new BackupError('La copia no contiene todos los datos esperados.');
  }
  return result;
}

export async function readV2PayloadAll(
  blob: Blob,
  opened: OpenedV2Container,
  onProgress?: (progress: ProgressInfo) => void,
): Promise<Uint8Array> {
  return readV2PayloadRange(
    blob,
    opened,
    0,
    opened.header.cipher.plainSize,
    (completed, total) => {
      onProgress?.({
        phase: 'decrypting',
        completed,
        total,
        percent: completed / total,
        detail: `${completed} de ${total} bloques`,
      });
    },
  );
}
