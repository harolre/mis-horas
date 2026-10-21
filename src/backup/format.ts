import type {
  Account,
  Attachment,
  AttachmentFile,
  DayEntry,
  ISODate,
  Movement,
  Settings,
} from '../types';

export const BACKUP_MAGIC = 'MHBK1';
export const BACKUP_FORMAT = 'mis-horas-backup';
export const BACKUP_VERSION = 1;
export const CHUNK_SIZE = 4 * 1024 * 1024;
export const KDF_ITERATIONS = 600_000;

export interface BackupAttachmentMeta {
  id: string;
  date: ISODate;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  offset: number;
  length: number;
  thumbOffset: number | null;
  thumbLength: number | null;
}

export interface BackupMeta {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion: string;
  accounts: Account[];
  movements: Movement[];
  days: DayEntry[];
  settings: Settings;
  attachments: BackupAttachmentMeta[];
}

export interface EncryptedHeader {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    ivPrefix: string;
    chunkSize: number;
    chunkCount: number;
    plainSize: number;
  };
}

export interface ParsedBackup {
  meta: BackupMeta;
  attachments: Attachment[];
  files: AttachmentFile[];
}

export interface ProgressInfo {
  phase: 'reading' | 'encrypting' | 'decrypting' | 'writing';
  completed: number;
  total: number;
  percent: number;
}

export interface BackupOptions {
  iterations?: number;
  chunkSize?: number;
  onProgress?: (info: ProgressInfo) => void;
  signal?: AbortSignal;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

export function uint32BE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

export function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function isBackupMeta(value: unknown): value is BackupMeta {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackupMeta>;
  return (
    candidate.format === BACKUP_FORMAT &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.accounts) &&
    Array.isArray(candidate.movements) &&
    Array.isArray(candidate.days) &&
    Array.isArray(candidate.attachments) &&
    typeof candidate.settings === 'object' &&
    candidate.settings !== null
  );
}
