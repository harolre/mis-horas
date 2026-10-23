import {
  IMAGE_MAX_DIMENSION,
  IMAGE_QUALITY,
  IMAGE_TARGET_MAX_BYTES,
  IMAGE_TARGET_REDUCTION,
  IMAGE_THUMB_DIMENSION,
  IMAGE_THUMB_QUALITY,
} from './constants';

export interface CompressedImage {
  blob: Blob;
  thumb: Blob;
  mime: string;
  width: number;
  height: number;
}

interface LoadedSource {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  cleanup: () => void;
}

export async function loadImageSource(file: File): Promise<LoadedSource> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Safari puede fallar con HEIC; probamos con <img>.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error('No se pudo leer la imagen. Prueba a convertirla a JPG.'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      cleanup: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function drawSource(
  source: ImageBitmap | HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('El navegador no permite procesar imágenes.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/jpeg',
  quality = IMAGE_QUALITY,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No se pudo comprimir la imagen.'));
      },
      type,
      quality,
    );
  });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  const loaded = await loadImageSource(file);
  try {
    const thumbScale = Math.min(
      1,
      IMAGE_THUMB_DIMENSION / Math.max(loaded.width, loaded.height),
    );
    const thumbCanvas = drawSource(
      loaded.source,
      Math.max(1, Math.round(loaded.width * thumbScale)),
      Math.max(1, Math.round(loaded.height * thumbScale)),
    );
    let thumb: Blob;
    try {
      thumb = await canvasToBlob(
        thumbCanvas,
        'image/jpeg',
        IMAGE_THUMB_QUALITY,
      );
    } finally {
      thumbCanvas.width = 0;
      thumbCanvas.height = 0;
    }

    const isSupportedOriginal =
      file.type === 'image/jpeg' ||
      file.type === 'image/png' ||
      file.type === 'image/webp';
    const maxSourceDimension = Math.max(loaded.width, loaded.height);
    const attempts = [
      { dimension: IMAGE_MAX_DIMENSION, quality: IMAGE_QUALITY },
      { dimension: 1800, quality: 0.8 },
      { dimension: 1600, quality: 0.76 },
      { dimension: 1440, quality: 0.72 },
      { dimension: 1280, quality: 0.68 },
      { dimension: 1120, quality: 0.64 },
      { dimension: 960, quality: 0.6 },
      { dimension: 800, quality: 0.56 },
      { dimension: 720, quality: 0.5 },
      { dimension: 640, quality: 0.45 },
    ];
    const targetBytes = Math.min(
      IMAGE_TARGET_MAX_BYTES,
      Math.floor(file.size * IMAGE_TARGET_REDUCTION),
    );

    async function encode(type: 'image/webp' | 'image/jpeg') {
      let best: { blob: Blob; width: number; height: number } | null = null;
      for (const attempt of attempts) {
        const scale = Math.min(1, attempt.dimension / maxSourceDimension);
        const width = Math.max(1, Math.round(loaded.width * scale));
        const height = Math.max(1, Math.round(loaded.height * scale));
        const canvas = drawSource(loaded.source, width, height);
        let candidate: Blob;
        try {
          candidate = await canvasToBlob(canvas, type, attempt.quality);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }

        // Browsers that do not encode WebP may silently return PNG instead.
        if (type === 'image/webp' && candidate.type !== 'image/webp') {
          return null;
        }
        if (!best || candidate.size < best.blob.size) {
          best = { blob: candidate, width, height };
        }
        if (candidate.size <= targetBytes) {
          return { blob: candidate, width, height };
        }
      }
      return best;
    }

    let webpResult: Awaited<ReturnType<typeof encode>>;
    try {
      webpResult = await encode('image/webp');
    } catch {
      webpResult = null;
    }
    let result = webpResult;
    if (!webpResult || webpResult.blob.size > targetBytes) {
      const jpegResult = await encode('image/jpeg');
      if (
        jpegResult &&
        (!result || jpegResult.blob.size < result.blob.size)
      ) {
        result = jpegResult;
      }
    }
    if (!result) throw new Error('No se pudo comprimir la imagen.');

    const preserveOriginal = isSupportedOriginal && result.blob.size >= file.size;

    return {
      blob: preserveOriginal ? file : result.blob,
      thumb,
      mime: preserveOriginal ? file.type : result.blob.type,
      width: preserveOriginal ? loaded.width : result.width,
      height: preserveOriginal ? loaded.height : result.height,
    };
  } finally {
    loaded.cleanup();
  }
}
