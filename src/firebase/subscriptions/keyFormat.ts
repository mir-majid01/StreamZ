// The canonical key format is the one StreamZ Admin mints with
// (core/domain/util/KeyGenerator.kt): four groups of five characters drawn from an
// alphabet that omits the confusable 0/O and 1/I/L. Both apps must agree
// character-for-character, because Firestore stores nothing but SHA-256 of the exact
// string a key was minted as — a formatting difference here is an invisible "key not
// found" in production.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LENGTH = 5;
const BODY_LENGTH = GROUPS * GROUP_LENGTH;

/**
 * Display prefixes an owner may paste along with a key. Never part of the hash.
 * They are stripped under two different rules, and the difference is deliberate:
 * 'FLK' can be stripped as soon as it is typed because 'L' is not in the alphabet, so
 * no real body ever starts with it; 'SZ' is stripped only at full length, because 'S'
 * and 'Z' are both legal body characters and a key may genuinely begin with them.
 */
const SZ_PREFIX = 'SZ';
const FLK_PREFIX = 'FLK';

function inAlphabet(body: string): boolean {
  for (const character of body) if (!ALPHABET.includes(character)) return false;
  return true;
}

function stripDisplayPrefix(cleaned: string): string {
  if (cleaned.length === BODY_LENGTH) return cleaned;
  if (cleaned.startsWith(FLK_PREFIX) && cleaned.length - FLK_PREFIX.length <= BODY_LENGTH) {
    return cleaned.slice(FLK_PREFIX.length);
  }
  if (cleaned.length === SZ_PREFIX.length + BODY_LENGTH && cleaned.startsWith(SZ_PREFIX)) {
    return cleaned.slice(SZ_PREFIX.length);
  }
  return cleaned;
}

/** Client-side display normalizer. Authorization is decided by Firestore rules only. */
export function normalizeKeyBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const body = stripDisplayPrefix(raw.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  if (body.length !== BODY_LENGTH) return null;
  return inAlphabet(body) ? body : null;
}

export function looksPlausible(raw: string): boolean {
  return normalizeKeyBody(raw) !== null;
}

/** The exact string a key was minted as: XXXXX-XXXXX-XXXXX-XXXXX, without any prefix. */
export function canonicalPlaintext(raw: unknown): string | null {
  const body = normalizeKeyBody(raw);
  if (!body) return null;
  return group(body);
}

export function formatKeyForDisplay(raw: string): string {
  return (
    canonicalPlaintext(raw) ??
    (typeof raw === 'string' ? raw.toUpperCase().slice(0, BODY_LENGTH) : '')
  );
}

/** Groups keystrokes as the user types, without ever rejecting input mid-entry. */
export function formatKeyInput(raw: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return group(stripDisplayPrefix(cleaned).slice(0, BODY_LENGTH));
}

function group(body: string): string {
  return body.replace(/(.{5})/g, '$1-').replace(/-$/, '');
}
