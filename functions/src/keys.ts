import { createHash, randomBytes } from 'crypto';

// Crockford base32 minus I, L, O, U. Must agree with the client normalizer; both are
// tested against the same fixtures/keyNormalization.json vectors.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'FLK';
const BODY_LENGTH = 12;
const HASH_VERSION = 'streamz:v1';

function inAlphabet(body: string): boolean {
  for (const c of body) if (!ALPHABET.includes(c)) return false;
  return true;
}

export function normalizeKeyBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === PREFIX.length + BODY_LENGTH && cleaned.startsWith(PREFIX)) {
    const body = cleaned.slice(PREFIX.length);
    return inAlphabet(body) ? body : null;
  }
  if (cleaned.length === BODY_LENGTH) return inAlphabet(cleaned) ? cleaned : null;
  return null;
}

export function hashKey(body: string): string {
  return createHash('sha256').update(`${HASH_VERSION}:${body}`).digest('hex');
}

export function formatKey(body: string): string {
  return `${PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/**
 * Rejection sampling: uniform bytes would bias the last characters because 256 is not a
 * multiple of 32, and a biased keyspace is a weaker keyspace.
 */
export function randomKeyBody(): string {
  const out: string[] = [];
  while (out.length < BODY_LENGTH) {
    for (const byte of randomBytes(32)) {
      if (byte < 256 - (256 % ALPHABET.length)) {
        out.push(ALPHABET[byte % ALPHABET.length]);
        if (out.length === BODY_LENGTH) break;
      }
    }
  }
  return out.join('');
}
