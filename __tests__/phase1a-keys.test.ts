/**
 * The server and the phone implement the same normalizer in two runtimes. This suite is
 * the referee: both read the same fixture, so a drift fails here instead of producing
 * keys that the user can type and the server cannot find.
 */
import vectors from '../fixtures/keyNormalization.json';
import { formatKey, hashKey, normalizeKeyBody, randomKeyBody } from '../functions/src/keys';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('server key normalizer agrees with the client fixture', () => {
  it.each(vectors.valid)('accepts $raw', ({ raw, normalized }) => {
    expect(normalizeKeyBody(raw)).toBe(normalized);
  });

  it.each(vectors.invalid)('rejects $reason', ({ raw }) => {
    expect(normalizeKeyBody(raw)).toBeNull();
  });

  it('rejects non-string input outright', () => {
    for (const raw of [null, undefined, 42, {}, [], true]) {
      expect(normalizeKeyBody(raw)).toBeNull();
    }
  });
});

describe('hashing and generation', () => {
  it('is deterministic, versioned and never reversible-looking', () => {
    const a = hashKey('7H3K92PQX8KM');
    expect(a).toBe(hashKey('7H3K92PQX8KM'));
    expect(a).toHaveLength(64);
    expect(a).not.toContain('7H3K92PQX8KM');
    // Version prefix means a future migration can be detected rather than silently mismatched.
    expect(hashKey('7H3K92PQX8KM')).not.toBe(require('crypto').createHash('sha256').update('7H3K92PQX8KM').digest('hex'));
  });

  it('formats for display and round-trips back to the same body', () => {
    const body = '7H3K92PQX8KM';
    expect(normalizeKeyBody(formatKey(body))).toBe(body);
  });

  it('generates keys inside the alphabet, of the right length, and distinct', () => {
    const bodies = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const body = randomKeyBody();
      expect(body).toHaveLength(12);
      expect([...body].every((c) => ALPHABET.includes(c))).toBe(true);
      bodies.add(body);
    }
    expect(bodies.size).toBeGreaterThan(490);
  });

  it('never produces a body that could be confused with the FLK prefix', () => {
    // L is excluded from the alphabet, so a bare body can never start with FLK.
    for (let i = 0; i < 200; i += 1) {
      expect(randomKeyBody().startsWith('FLK')).toBe(false);
    }
  });
});
