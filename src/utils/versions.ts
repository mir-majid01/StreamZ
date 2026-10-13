/**
 * Turn `1.2.3` (or `v1.2.3`, `1.2.3-beta`) into a comparable integer:
 * `MAJOR * 1_000_000 + MINOR * 1_000 + PATCH`. Pre-release suffixes are
 * ignored so a `-beta` tag equals its stable counterpart.
 */
const parseVersion = (version: string): number => {
  const clean = String(version ?? '')
    .trim()
    .replace(/^v/, '')
    .split('-')[0];
  const parts = clean.split('.').map((p) => parseInt(p, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2];
};

/** Returns 1 if a > b, -1 if a < b, 0 if equal. */
export const compareVersions = (a: string, b: string): number => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa > pb) return 1;
  if (pa < pb) return -1;
  return 0;
};

/** True when `installed` is older than `required`. */
export const isBelowMinimum = (installed: string, required: string): boolean =>
  compareVersions(installed, required) < 0;
