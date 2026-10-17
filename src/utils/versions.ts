/**
 * Version comparison for the update gate.
 *
 * Components are compared numerically against each other rather than folded into
 * one integer: `MAJOR * 1e6 + MINOR * 1e3 + PATCH` reads `1.1000.0` as `2.0.0`
 * and silently drops a fourth component, which is the difference between "this
 * build is current" and "this build is years ahead of you".
 */
const components = (version: string): number[] => {
  const clean = String(version ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];
  const parts = clean.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts;
};

/** Returns 1 if a > b, -1 if a < b, 0 if equal. Pre-release suffixes are ignored. */
export const compareVersions = (a: string, b: string): number => {
  const pa = components(a);
  const pb = components(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff > 0) return 1;
    if (diff < 0) return -1;
  }
  return 0;
};

/** True when `installed` is older than `required`. */
export const isBelowMinimum = (installed: string, required: string): boolean =>
  compareVersions(installed, required) < 0;

/**
 * `versionCode` is what Android actually refuses to downgrade, and two builds of
 * the same `versionName` are distinguishable only by it — so a gate that ignores
 * it can report "up to date" about a build the installer would reject.
 */
export const compareVersionCodes = (a: number | null, b: number | null): number => {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
};

/**
 * Is `available` newer than `installed`? Version names first; when the names are
 * equal, the codes decide, and a missing code on either side means no claim.
 */
export const isNewerRelease = (
  installed: { version: string; code: number | null },
  available: { version: string; code: number | null },
): boolean => {
  const byName = compareVersions(available.version, installed.version);
  if (byName !== 0) return byName > 0;
  return compareVersionCodes(available.code, installed.code) > 0;
};
