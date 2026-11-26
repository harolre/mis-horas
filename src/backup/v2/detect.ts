import { BACKUP_MAGIC, readUint32 } from '../format';
import {
  V2_FORMAT,
  V2_MAGIC,
  V2_VERSION,
  type BackupFileKind,
  type V2Header,
} from './format';

const decoder = new TextDecoder();

async function readBytes(
  blob: Blob,
  start: number,
  length: number,
): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

export async function detectBackupKind(
  blob: Blob,
): Promise<BackupFileKind> {
  if (blob.size < 9) return 'unknown';
  const magic = decoder.decode(await readBytes(blob, 0, 5));
  if (magic === BACKUP_MAGIC) return 'legacy';
  if (magic !== V2_MAGIC) return 'unknown';
  const headerLength = readUint32(
    new DataView((await readBytes(blob, 5, 4)).buffer),
    0,
  );
  if (
    headerLength <= 0 ||
    headerLength > 1024 * 1024 ||
    9 + headerLength > blob.size
  ) {
    return 'unknown';
  }
  try {
    const header = JSON.parse(
      decoder.decode(await readBytes(blob, 9, headerLength)),
    ) as Partial<V2Header>;
    if (
      header.format === V2_FORMAT &&
      header.version === V2_VERSION &&
      (header.kind === 'data' || header.kind === 'attachments')
    ) {
      return header.kind;
    }
  } catch {
    return 'unknown';
  }
  return 'unknown';
}
