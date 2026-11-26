import type {
  Account,
  Attachment,
  DayEntry,
  Movement,
  Settings,
} from '../../types';

export const V2_FORMAT = 'mis-horas-backup';
export const V2_VERSION = 2;
export const V2_MAGIC = 'MHBK2';
export const DATA_EXTENSION = '.mhdata';
export const ATTACHMENTS_EXTENSION = '.mhatt';

export type V2Kind = 'data' | 'attachments';
export type BackupFileKind = 'data' | 'attachments' | 'legacy' | 'unknown';

export interface AttachmentIndexEntry {
  id: string;
  date: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  year: string;
}

export interface AttachmentArchiveEntry extends AttachmentIndexEntry {
  offset: number;
  length: number;
  thumbOffset: number | null;
  thumbLength: number | null;
  sha256: string;
  thumbSha256: string | null;
}

export interface DataBackupPayload {
  format: typeof V2_FORMAT;
  version: typeof V2_VERSION;
  kind: 'data';
  createdAt: string;
  appVersion: string;
  accounts: Account[];
  movements: Movement[];
  days: DayEntry[];
  settings: Settings;
  attachments: AttachmentIndexEntry[];
}

export interface AttachmentsBackupMeta {
  format: typeof V2_FORMAT;
  version: typeof V2_VERSION;
  kind: 'attachments';
  createdAt: string;
  appVersion: string;
  year: string;
  entries: AttachmentArchiveEntry[];
}

export interface V2Header {
  format: typeof V2_FORMAT;
  version: typeof V2_VERSION;
  kind: V2Kind;
  createdAt: string;
  appVersion: string;
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
    metaSize: number;
    metaCipherLength: number;
  };
}

export interface OpenedV2Container {
  header: V2Header;
  key: CryptoKey;
  metaStart: number;
  payloadStart: number;
}

export function indexEntryFromAttachment(
  attachment: Attachment,
): AttachmentIndexEntry {
  return {
    id: attachment.id,
    date: attachment.date,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    createdAt: attachment.createdAt,
    year: attachment.date.slice(0, 4),
  };
}

export function isDataBackupPayload(value: unknown): value is DataBackupPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DataBackupPayload>;
  return (
    candidate.format === V2_FORMAT &&
    candidate.version === V2_VERSION &&
    candidate.kind === 'data' &&
    Array.isArray(candidate.accounts) &&
    Array.isArray(candidate.movements) &&
    Array.isArray(candidate.days) &&
    Array.isArray(candidate.attachments) &&
    typeof candidate.settings === 'object' &&
    candidate.settings !== null
  );
}

export function isAttachmentsBackupMeta(
  value: unknown,
): value is AttachmentsBackupMeta {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AttachmentsBackupMeta>;
  return (
    candidate.format === V2_FORMAT &&
    candidate.version === V2_VERSION &&
    candidate.kind === 'attachments' &&
    typeof candidate.year === 'string' &&
    Array.isArray(candidate.entries)
  );
}
