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
 * The unit a duration is actually measured in, with the number that goes with it. Shared by
 * "3 days left" and "3 days ago" so the two can never drift into different vocabularies.
 * Rounding here is deliberately upward: a term that has 40 seconds left is not "0 min".
 */
const durationUpParts = (ms: number): { value: string; unit: string } => {
  const minutes = Math.ceil(ms / MINUTE_MS);
  // Rounding up to whole minutes can land on 60, and 60 minutes is an hour —
  // the hours branch below reads it as one instead of printing "60 min".
  if (minutes < 60) {
    return { value: String(minutes), unit: 'min' };
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const rest = Math.ceil((ms % HOUR_MS) / MINUTE_MS);
    // 90 minutes is "1 h 30 min", but a round 23 hours should not read "23 h 0 min".
    return rest > 0 && rest < 60
      ? { value: `${hours} h ${rest}`, unit: 'min' }
      : { value: String(hours + (rest === 60 ? 1 : 0)), unit: 'h' };
  }
  const days = Math.ceil(ms / DAY_MS);
  return { value: String(days), unit: days === 1 ? 'day' : 'days' };
};

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
  const { value, unit } = durationUpParts(remainingMs);
  return { value, unit: `${unit} left` };
};

export const timeLeftLabel = (remainingMs: number): string => {
  const { value, unit } = timeLeftParts(remainingMs);
  return `${value} ${unit}`;
};

/**
 * How long before now an instant passed — "expired 3 days ago".
 *
 * Rounding here is deliberately downward, unlike the remaining-term label: time that has
 * already gone must not be overstated, and "expired 2 min ago" for something that went out of
 * date five seconds ago is a made-up duration. Below one full minute it returns null, because
 * the honest answer then is simply "has expired" and the caller says that.
 */
export const timeAgoLabel = (elapsedMs: number): string | null => {
  if (!Number.isFinite(elapsedMs) || elapsedMs < MINUTE_MS) return null;
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)} min ago`;
  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    const rest = Math.floor((elapsedMs % HOUR_MS) / MINUTE_MS);
    return rest > 0 ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  }
  const days = Math.floor(elapsedMs / DAY_MS);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
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
