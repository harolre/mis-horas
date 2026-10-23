export type BinaryData = Blob | ArrayBuffer;

export function binaryToArrayBuffer(
  data: BinaryData | null,
): Promise<ArrayBuffer | null> {
  if (!data) return Promise.resolve(null);
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.arrayBuffer();
  }
  return Promise.resolve(data as ArrayBuffer);
}

export function blobToArrayBuffer(blob: Blob | null): Promise<ArrayBuffer | null> {
  return binaryToArrayBuffer(blob);
}

export function binaryToBlob(
  data: BinaryData | null,
  type = 'application/octet-stream',
): Blob | null {
  if (!data) return null;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
  return new Blob([data as ArrayBuffer], { type });
}
