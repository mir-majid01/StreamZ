import { createHash, randomBytes } from 'crypto';

// Canonical key format, owned by StreamZ Admin (core/domain/util/KeyGenerator.kt) and
// mirrored by the user app (src/firebase/subscriptions/keyFormat.ts). Four groups of
// five characters from an alphabet without the confusable 0/O and 1/I/L. All three
// implementations are tested against the same fixtures/keyNormalization.json vectors.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SZ_PREFIX = 'SZ';
const FLK_PREFIX = 'FLK';
const GROUPS = 4;
const GROUP_LENGTH = 5;
const BODY_LENGTH = GROUPS * GROUP_LENGTH;

function inAlphabet(body: string): boolean {
  for (const character of body) if (!ALPHABET.includes(character)) return false;
  return true;
}

export function normalizeKeyBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body =
    cleaned.length === BODY_LENGTH
      ? cleaned
      : cleaned.startsWith(FLK_PREFIX) && cleaned.length - FLK_PREFIX.length <= BODY_LENGTH
        ? cleaned.slice(FLK_PREFIX.length)
        : cleaned.length === SZ_PREFIX.length + BODY_LENGTH && cleaned.startsWith(SZ_PREFIX)
          ? cleaned.slice(SZ_PREFIX.length)
          : cleaned;
  if (body.length !== BODY_LENGTH) return null;
  return inAlphabet(body) ? body : null;
}

/** The exact string a key was minted as — and therefore the only hash preimage. */
export function canonicalPlaintext(body: string): string {
  return body.replace(/(.{5})/g, '$1-').replace(/-$/, '');
}

export function hashKey(body: string): string {
  return createHash('sha256').update(canonicalPlaintext(body)).digest('hex');
}

export function formatKey(body: string): string {
  return canonicalPlaintext(body);
}

/**
 * Rejection sampling: uniform bytes would bias the last characters because 256 is not a
 * multiple of the alphabet length, and a biased keyspace is a weaker keyspace.
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
