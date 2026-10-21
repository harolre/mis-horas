import {
  MAX_ATTACHMENT_BYTES,
  MAX_INPUT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from './constants';
import { compressImage } from './image';
import { compressPdf } from './pdf';

export interface PreparedAttachment {
  blob: Blob;
  thumb: Blob | null;
  mime: string;
  name: string;
  originalSize: number;
  finalSize: number;
  kind: 'image' | 'pdf';
  compression: 'imagen' | 'pdf-sin-perdida' | 'pdf-rasterizado' | 'original';
}

export interface AttachmentProgress {
  stage: 'leyendo' | 'analizando' | 'comprimiendo' | 'guardando';
  percent: number;
  detail?: string;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const PDF_EXTENSIONS = new Set(['pdf']);

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || PDF_EXTENSIONS.has(extensionOf(file.name));
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSIONS.has(extensionOf(file.name));
}

function replaceExtension(name: string, extension: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return `${base || 'adjunto'}.${extension}`;
}

function sanitizeName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return (clean || 'adjunto').slice(0, 120);
}

async function assertPdfSignature(file: File): Promise<void> {
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const text = String.fromCharCode(...header);
  if (!text.startsWith('%PDF-')) {
    throw new Error('El archivo no parece un PDF válido.');
  }
}

export async function prepareAttachment(
  file: File,
  options: {
    onProgress?: (progress: AttachmentProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<PreparedAttachment> {
  if (file.size === 0) {
    throw new Error('El archivo está vacío.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(
      `El archivo supera el máximo de entrada de 25 MB (${(file.size / (1024 * 1024)).toFixed(1)} MB).`,
    );
  }

  const progress = options.onProgress ?? (() => undefined);
  progress({ stage: 'leyendo', percent: 0.05 });

  if (isPdfFile(file)) {
    await assertPdfSignature(file);
    const result = await compressPdf(file, {
      signal: options.signal,
      onProgress: (info) => {
        progress({
          stage: info.stage === 'analizando' ? 'analizando' : 'comprimiendo',
          percent: info.percent,
          detail: `Página ${info.page} de ${info.total}`,
        });
      },
    });
    if (result.blob.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        'El PDF sigue superando los 10 MB después de comprimirlo.',
      );
    }
    progress({ stage: 'guardando', percent: 1 });
    return {
      blob: result.blob,
      thumb: result.thumb,
      mime: 'application/pdf',
      name: sanitizeName(replaceExtension(file.name, 'pdf')),
      originalSize: file.size,
      finalSize: result.blob.size,
      kind: 'pdf',
      compression:
        result.mode === 'rasterized'
          ? 'pdf-rasterizado'
          : result.mode === 'lossless'
            ? 'pdf-sin-perdida'
            : 'original',
    };
  }

  if (isImageFile(file)) {
    progress({ stage: 'comprimiendo', percent: 0.2 });
    const result = await compressImage(file);
    if (options.signal?.aborted) {
      throw new DOMException('Cancelado', 'AbortError');
    }
    if (result.blob.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        'La imagen sigue superando los 10 MB después de comprimirla.',
      );
    }
    const extension =
      result.mime === 'image/png'
        ? 'png'
        : result.mime === 'image/webp'
          ? 'webp'
          : 'jpg';
    progress({ stage: 'guardando', percent: 1 });
    return {
      blob: result.blob,
      thumb: result.thumb,
      mime: result.mime,
      name: sanitizeName(replaceExtension(file.name, extension)),
      originalSize: file.size,
      finalSize: result.blob.size,
      kind: 'image',
      compression: 'imagen',
    };
  }

  throw new Error('Solo se admiten imágenes (JPG, PNG, WebP, HEIC) o PDF.');
}

export function checkTotalLimit(
  currentTotal: number,
  incomingSize: number,
): string | null {
  if (currentTotal + incomingSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    return 'Se alcanzaría el límite de 100 MB de adjuntos. Borra algún archivo antes de añadir otro.';
  }
  return null;
}
