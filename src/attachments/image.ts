import {
  IMAGE_MAX_DIMENSION,
  IMAGE_QUALITY,
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
    const scale = Math.min(
      1,
      IMAGE_MAX_DIMENSION / Math.max(loaded.width, loaded.height),
    );
    const width = Math.max(1, Math.round(loaded.width * scale));
    const height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = drawSource(loaded.source, width, height);
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', IMAGE_QUALITY);

    const thumbScale = Math.min(
      1,
      IMAGE_THUMB_DIMENSION / Math.max(loaded.width, loaded.height),
    );
    const thumbCanvas = drawSource(
      loaded.source,
      Math.max(1, Math.round(loaded.width * thumbScale)),
      Math.max(1, Math.round(loaded.height * thumbScale)),
    );
    const thumb = await canvasToBlob(
      thumbCanvas,
      'image/jpeg',
      IMAGE_THUMB_QUALITY,
    );

    const canKeepOriginal =
      (file.type === 'image/jpeg' ||
        file.type === 'image/png' ||
        file.type === 'image/webp') &&
      file.size < jpeg.size;
    const blob = canKeepOriginal ? file : jpeg;
    const mime = canKeepOriginal ? file.type : 'image/jpeg';

    canvas.width = 0;
    canvas.height = 0;
    thumbCanvas.width = 0;
    thumbCanvas.height = 0;

    return { blob, thumb, mime, width, height };
  } finally {
    loaded.cleanup();
  }
}
