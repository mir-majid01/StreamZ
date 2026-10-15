const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface TimeLeft {
  /** The number, or the compound "1 h 30" — the part a screen draws large. */
  value: string;
  /** The unit and the word "left" — the part a screen draws small. */
  unit: string;
}

/**
 * How much of a subscription term remains, in the unit that actually describes
 * it. A key minted for four minutes is not "1 day left" (which is what rounding
 * up to whole days produced), and a month-long key still reads "31 days left".
 * The two parts are returned separately because the panels draw them at
 * different sizes; splitting the finished string at a screen would be guesswork.
 */
export const timeLeftParts = (remainingMs: number): TimeLeft => {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return { value: 'No', unit: 'time left' };
  }
  const minutes = Math.ceil(remainingMs / MINUTE_MS);
  // Rounding up to whole minutes can land on 60, and 60 minutes is an hour —
  // the hours branch below reads it as one instead of printing "60 min left".
  if (minutes < 60) {
    return { value: String(minutes), unit: 'min left' };
  }
  if (remainingMs < DAY_MS) {
    const hours = Math.floor(remainingMs / HOUR_MS);
    const rest = Math.ceil((remainingMs % HOUR_MS) / MINUTE_MS);
    // 90 minutes is "1 h 30 min", but a round 23 hours should not read "23 h 0 min".
    return rest > 0 && rest < 60
      ? { value: `${hours} h ${rest}`, unit: 'min left' }
      : { value: String(hours + (rest === 60 ? 1 : 0)), unit: 'h left' };
  }
  const days = Math.ceil(remainingMs / DAY_MS);
  return { value: String(days), unit: days === 1 ? 'day left' : 'days left' };
};

export const timeLeftLabel = (remainingMs: number): string => {
  const { value, unit } = timeLeftParts(remainingMs);
  return `${value} ${unit}`;
};

/**
 * When the term ends. A date is enough for a month-long subscription; for
 * anything ending within a day and a half, the clock time is the only part that
 * is true, so "Ends 15 Oct" becomes "Ends 15 Oct, 12:04".
 */
export const expiryLabel = (expiresAt: number, nowMs: number): string => {
  const ends = new Date(expiresAt);
  const date = ends.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (expiresAt - nowMs > 36 * HOUR_MS) return date;
  return `${date}, ${ends.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
