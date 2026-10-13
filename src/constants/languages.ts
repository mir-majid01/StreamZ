/**
 * Curated list of subtitle languages exposed as the default-language options
 * in Settings. `code` is an ISO 639-1 value understood by the Wyzie API; an
 * empty code represents "None" (no auto-selection).
 */
export interface SubLanguage {
  code: string;
  label: string;
}

export const SUBTITLE_LANGUAGES: SubLanguage[] = [
  { code: '', label: 'None' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ur', label: 'Urdu' },
];

/**
 * Languages written in a right-to-left script, so captions need RTL layout.
 *
 * This is a property of the script, not of the region. Deliberately excluded:
 * Devanagari/Tamil/Telugu/Bengali languages (`hi`, `ta`, `te`, `bn`), which are
 * South-Asian but left-to-right, and `ku`/`sd`, which are written RTL in the
 * Arabic script and LTR in Latin/Devanagari depending on variety — for those we
 * cannot tell from an ISO 639-1 code alone, so we leave them alone.
 */
const RTL_LANGUAGE_CODES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'yi']);

/** Whether a language tag (bare or region-qualified) needs RTL layout. */
export const isRtlLanguage = (code: string): boolean => {
  const base = String(code || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return RTL_LANGUAGE_CODES.has(base);
};

export const getLanguageLabel = (code: string): string =>
  SUBTITLE_LANGUAGES.find((l) => l.code === code)?.label ?? 'None';

/** Best-effort ISO 639-1 from a human subtitle label (e.g. "English Hi"). */
export const languageFromLabel = (label: string): string => {
  const lower = String(label || '').toLowerCase();
  const known = SUBTITLE_LANGUAGES.find(
    (l) => l.code && lower.includes(l.label.toLowerCase()),
  );
  if (known) return known.code;
  return lower.slice(0, 2);
};
