import { BackupError, KDF_ITERATIONS, uint32BE } from './format';

const encoder = new TextEncoder();

export function assertCryptoAvailable(): void {
  if (
    typeof crypto === 'undefined' ||
    !crypto.subtle ||
    typeof crypto.subtle.deriveKey !== 'function'
  ) {
    throw new BackupError(
      'El cifrado no está disponible. Abre la app por HTTPS o en localhost.',
    );
  }
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations = KDF_ITERATIONS,
): Promise<CryptoKey> {
  assertCryptoAvailable();
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function makeIv(prefix: Uint8Array, index: number): Uint8Array {
  if (prefix.length !== 8) {
    throw new BackupError('El vector de inicialización no es válido.');
  }
  const iv = new Uint8Array(12);
  iv.set(prefix, 0);
  iv.set(uint32BE(index), 8);
  return iv;
}

export function makeAad(
  magic: string,
  index: number,
  total: number,
): Uint8Array {
  return encoder.encode(`${magic}|${index}|${total}`);
}

export async function encryptChunk(
  key: CryptoKey,
  data: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
    key,
    data,
  );
  return new Uint8Array(encrypted);
}

export async function decryptChunk(
  key: CryptoKey,
  data: Uint8Array,
  iv: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      key,
      data,
    );
    return new Uint8Array(decrypted);
  } catch {
    throw new BackupError('Contraseña incorrecta o archivo dañado.');
  }
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
