/**
 * Helpers de criptografía sobre la WebCrypto API (disponible en Workers).
 *
 * - hmacSha256: para firmar tokens, verificar Flow callbacks.
 * - sha256: para hashear tokens antes de guardarlos en BD.
 * - randomToken: bytes seguros para tokens de verificación, reset, etc.
 * - constantTimeEqual: comparación timing-safe.
 * - hashPassword / verifyPassword: bcrypt-equivalente con PBKDF2 + scrypt-style.
 *
 * Para passwords usamos PBKDF2 con SHA-256 (disponible en Workers).
 * Argon2id sería ideal pero requiere WASM extra; PBKDF2 600k iter es OK
 * según OWASP 2024.
 */

const PBKDF2_ITERATIONS = 600000; // OWASP 2024 recomendación
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ==========================================================================
// Random
// ==========================================================================

/** Genera n bytes aleatorios criptográficamente seguros, en hex. */
export function randomToken(byteLength = 32): string {
  const arr = new Uint8Array(byteLength);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

/** UUID v4 (alternativa a randomToken si quieres formato UUID) */
export function uuid(): string {
  return crypto.randomUUID();
}

// ==========================================================================
// Encoding helpers
// ==========================================================================

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hexToBytes: longitud impar');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ==========================================================================
// HMAC SHA-256
// ==========================================================================

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Firma un mensaje con HMAC-SHA256, devuelve hex. */
export async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

/** Verifica una firma HMAC-SHA256. Timing-safe. */
export async function verifyHmacSha256(secret: string, message: string, signatureHex: string): Promise<boolean> {
  try {
    const expected = await hmacSha256(secret, message);
    return constantTimeEqual(expected, signatureHex);
  } catch {
    return false;
  }
}

// ==========================================================================
// SHA-256 (one-way hash)
// ==========================================================================

export async function sha256(input: string): Promise<string> {
  const data = encoder.encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(buf));
}

// ==========================================================================
// Constant-time string comparison (timing attack prevention)
// ==========================================================================

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Aún así corremos la comparación con un dummy para no filtrar longitud
    const dummy = b.length === 0 ? a : b;
    let _result = 0;
    for (let i = 0; i < a.length; i++) {
      _result |= a.charCodeAt(i) ^ dummy.charCodeAt(i % dummy.length);
    }
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ==========================================================================
// Password hashing — PBKDF2-SHA256 con 600k iterations (OWASP 2024)
// Formato del hash: pbkdf2$sha256$600000$<salt_b64>$<hash_b64>
// ==========================================================================

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, iterations, KEY_LENGTH);
  return `pbkdf2$sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Soporta dos formatos:
  //   1. pbkdf2$sha256$<iter>$<salt>$<hash>   (nuevo)
  //   2. cualquier hash bcrypt/argon2 viejo desde import MySQL → no soportado, hay que rehashear
  if (!stored.startsWith('pbkdf2$')) {
    // Formato no reconocido — ejecuta una operación dummy para timing-safe
    // y retorna false. La app debe manejar la migración.
    await pbkdf2('dummy', new Uint8Array(SALT_LENGTH), 1000, 32);
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 5) return false;
  const [, , iterStr, saltB64, hashB64] = parts as [string, string, string, string, string];
  const iterations = parseInt(iterStr, 10);
  if (!iterations || iterations < 100000) return false; // seguridad mínima
  const salt = base64ToBytes(saltB64);
  const expected = base64ToBytes(hashB64);
  const computed = await pbkdf2(password, salt, iterations, expected.length);
  return constantTimeEqualBytes(computed, expected);
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  keyLengthBytes: number,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    baseKey,
    keyLengthBytes * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return result === 0;
}

// ==========================================================================
// Hash dummy para timing-safe login
// (usar cuando el usuario no existe, para que el tiempo de respuesta sea similar)
// ==========================================================================

export const DUMMY_PASSWORD_HASH =
  'pbkdf2$sha256$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Espera entre min y max ms para añadir jitter aleatorio anti-timing. */
export async function jitter(minMs = 50, maxMs = 250): Promise<void> {
  const delay = minMs + Math.floor(Math.random() * (maxMs - minMs));
  await new Promise(resolve => setTimeout(resolve, delay));
}
