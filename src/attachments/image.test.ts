import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImage } from './image';

function mockImageEncoder(
  encode: (type: string, quality: number) => Blob,
) {
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4000, height: 3000, close })),
  );
  vi.stubGlobal('document', {
    createElement: () => {
      const context = {
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        fillStyle: '',
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
      };
      return {
        width: 0,
        height: 0,
        getContext: () => context,
        toBlob: (
          callback: BlobCallback,
          type = 'image/png',
          quality = 1,
        ) => callback(encode(type, quality)),
      };
    },
  });
  return close;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('compresión de imágenes', () => {
  it('recomprime también una imagen pequeña si obtiene un archivo menor', async () => {
    const encode = vi.fn(
      (type: string) => new Blob([new Uint8Array(25 * 1024)], { type }),
    );
    const close = mockImageEncoder(encode);
    const file = new File([new Uint8Array(100 * 1024)], 'pequena.jpg', {
      type: 'image/jpeg',
    });

    const result = await compressImage(file);

    expect(result.blob).not.toBe(file);
    expect(result.blob.size).toBe(25 * 1024);
    expect(result.mime).toBe('image/webp');
    expect(encode).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });

  it('mantiene el original pequeño si la versión comprimida pesa más', async () => {
    const encode = vi.fn(
      (type: string) => new Blob([new Uint8Array(120 * 1024)], { type }),
    );
    mockImageEncoder(encode);
    const file = new File([new Uint8Array(100 * 1024)], 'pequena.jpg', {
      type: 'image/jpeg',
    });

    const result = await compressImage(file);

    expect(result.blob).toBe(file);
    expect(result.mime).toBe('image/jpeg');
    expect(encode).toHaveBeenCalledWith('image/jpeg', expect.any(Number));
  });

  it('reduce una foto grande a menos de 800 KB usando WebP', async () => {
    const encode = vi.fn((type: string) =>
      type === 'image/webp'
        ? new Blob([new Uint8Array(700 * 1024)], { type })
        : new Blob(['thumb'], { type }),
    );
    mockImageEncoder(encode);
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'foto.jpg', {
      type: 'image/jpeg',
    });

    const result = await compressImage(file);

    expect(result.mime).toBe('image/webp');
    expect(result.blob.size).toBeLessThanOrEqual(800 * 1024);
    expect(result.blob.size).toBeLessThan(file.size);
    expect(result.width).toBe(2048);
  });

  it('sigue comprimiendo una foto de 738 KB hasta intentar reducirla a la mitad', async () => {
    let webpAttempts = 0;
    const encode = vi.fn((type: string) => {
      if (type === 'image/webp') {
        webpAttempts += 1;
        const size = webpAttempts === 1 ? 500 * 1024 : 350 * 1024;
        return new Blob([new Uint8Array(size)], { type });
      }
      return new Blob(['thumb'], { type: 'image/jpeg' });
    });
    mockImageEncoder(encode);
    const file = new File([new Uint8Array(738 * 1024)], 'foto.jpg', {
      type: 'image/jpeg',
    });

    const result = await compressImage(file);

    expect(webpAttempts).toBe(2);
    expect(result.blob.size).toBe(350 * 1024);
    expect(result.blob.size).toBeLessThanOrEqual(file.size * 0.5);
  });

  it('usa JPEG si el navegador no puede codificar WebP', async () => {
    const encode = vi.fn((type: string) =>
      type === 'image/webp'
        ? new Blob(['unsupported'], { type: 'image/png' })
        : new Blob([new Uint8Array(600 * 1024)], { type }),
    );
    mockImageEncoder(encode);
    const file = new File([new Uint8Array(2 * 1024 * 1024)], 'foto.jpg', {
      type: 'image/jpeg',
    });

    const result = await compressImage(file);

    expect(result.mime).toBe('image/jpeg');
    expect(result.blob.size).toBe(600 * 1024);
    expect(encode).toHaveBeenCalledWith('image/webp', expect.any(Number));
    expect(encode).toHaveBeenCalledWith('image/jpeg', expect.any(Number));
  });
});
