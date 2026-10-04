// Crockford base32 minus I, L, O, U. Excluding L is what makes the "FLK" display prefix
// unambiguous: a 12-char body can never itself begin with FLK, so a 15-char cleaned value
// is always prefix + body and a 12-char cleaned value is always a bare body.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'FLK';

function inAlphabet(body: string): boolean {
  for (const c of body) if (!ALPHABET.includes(c)) return false;
  return true;
}

/** Client-side display normalizer. Authorization is decided server-side only. */
export function normalizeKeyBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length === PREFIX.length + 12 && cleaned.startsWith(PREFIX)) {
    const body = cleaned.slice(PREFIX.length);
    return inAlphabet(body) ? body : null;
  }
  if (cleaned.length === 12) return inAlphabet(cleaned) ? cleaned : null;
  return null;
}

export function looksPlausible(raw: string): boolean {
  return normalizeKeyBody(raw) !== null;
}

export function formatKeyForDisplay(raw: string): string {
  const body = normalizeKeyBody(raw);
  if (body) return `${PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
  return typeof raw === 'string' ? raw.toUpperCase().slice(0, 20) : '';
}

/** Groups keystrokes as the user types, without ever rejecting input mid-entry. */
export function formatKeyInput(raw: string): string {
  const cleaned = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const hadPrefix = cleaned.startsWith(PREFIX);
  const body = hadPrefix ? cleaned.slice(PREFIX.length) : cleaned;
  const capped = body.slice(0, 12);
  const groups = [capped.slice(0, 4), capped.slice(4, 8), capped.slice(8, 12)].filter(Boolean);
  return `${PREFIX}-${groups.join('-')}`;
}
