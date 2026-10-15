import {
  expiryLabel,
  timeLeftLabel,
  timeLeftParts,
} from '@/src/utils/subscriptionTerms';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('timeLeftLabel', () => {
  it('names a sub-day term in the unit it was minted in', () => {
    expect(timeLeftLabel(4 * MIN)).toBe('4 min left');
    expect(timeLeftLabel(30 * MIN)).toBe('30 min left');
    // 90 minutes used to round up to "1 day left", which is the whole point of
    // a short key: it is minted to be checked, not to be rounded.
    expect(timeLeftLabel(90 * MIN)).toBe('1 h 30 min left');
  });

  it('keeps whole-hour and whole-day terms whole', () => {
    expect(timeLeftLabel(23 * HOUR)).toBe('23 h left');
    expect(timeLeftLabel(59 * MIN + 30_000)).toBe('1 h left');
    expect(timeLeftLabel(DAY)).toBe('1 day left');
    expect(timeLeftLabel(30 * DAY)).toBe('30 days left');
    // A term that has just started still reads as its full length, not one less.
    expect(timeLeftLabel(30 * DAY - 1)).toBe('30 days left');
  });

  it('says so when the term is over rather than showing a negative', () => {
    expect(timeLeftLabel(0)).toBe('No time left');
    expect(timeLeftLabel(-MIN)).toBe('No time left');
    expect(timeLeftLabel(Number.NaN)).toBe('No time left');
  });

  it('splits into the parts a panel draws at two sizes', () => {
    expect(timeLeftParts(4 * MIN)).toEqual({ value: '4', unit: 'min left' });
    expect(timeLeftParts(30 * DAY)).toEqual({ value: '30', unit: 'days left' });
  });
});

describe('expiryLabel', () => {
  const now = new Date('2026-10-15T09:00:00').getTime();

  it('gives only a date for a term that ends far away', () => {
    const label = expiryLabel(now + 30 * DAY, now);
    expect(label).toMatch(/2026/);
    // The date itself is locale-formatted and carries a comma ("Nov 14, 2026"),
    // so what the far case must drop is the clock time.
    expect(label).not.toMatch(/\d:\d{2}/);
  });

  it('adds the clock time when the term ends within a day and a half', () => {
    const label = expiryLabel(now + 4 * MIN, now);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
    // The minutes have to be visible: "Ends 15 Oct" for a key expiring at
    // 09:04 is the same rounding error the label above fixes.
    expect(label).toMatch(/0?9:04|[1-9]:04/);
  });
});
