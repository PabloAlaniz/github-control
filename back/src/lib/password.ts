/**
 * Password hashing with PBKDF2-SHA256 over Web Crypto, so it runs unchanged
 * on Node and on Cloudflare Workers (which cap PBKDF2 at 100,000 iterations).
 *
 * Stored format: pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>
 */
const ALGORITHM = 'pbkdf2-sha256';
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS);
  return new Uint8Array(bits);
}

/** Compares without leaking, through timing, where the inputs first differ. */
export function constantTimeEqual(a: Uint8Array | string, b: Uint8Array | string): boolean {
  const x = typeof a === 'string' ? encoder.encode(a) : a;
  const y = typeof b === 'string' ? encoder.encode(b) : b;
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return [ALGORITHM, ITERATIONS, toBase64(salt), toBase64(hash)].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, salt, hash] = stored.split('$');
  if (algorithm !== ALGORITHM || !iterations || !salt || !hash) return false;
  const count = Number(iterations);
  if (!Number.isInteger(count) || count < 1 || count > ITERATIONS) return false;
  try {
    return constantTimeEqual(await derive(password, fromBase64(salt), count), fromBase64(hash));
  } catch {
    return false;
  }
}

/** Random URL-safe secret (default 32 bytes of entropy). */
export function randomSecret(bytes = 32): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
