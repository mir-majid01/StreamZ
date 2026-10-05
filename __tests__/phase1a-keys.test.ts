/**
 * Three runtimes implement the same key grammar: StreamZ Admin (Kotlin), the user app
 * (TypeScript) and the undeployed functions project. This suite is the referee — all
 * read the same fixture, so drift fails here instead of producing keys a user can type
 * and the database cannot find.
 */
import { createHash } from 'crypto';
import vectors from '../fixtures/keyNormalization.json';
import { formatKey, hashKey, normalizeKeyBody, randomKeyBody } from '../functions/src/keys';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BODY = '8JKM2NPQRS4T6VW7XYZA';
const PLAINTEXT = '8JKM2-NPQRS-4T6VW-7XYZA';

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
  it('hashes the canonical dashed plaintext, exactly as the admin app does', () => {
    expect(hashKey(BODY)).toBe(createHash('sha256').update(PLAINTEXT).digest('hex'));
    expect(hashKey(BODY)).toBe(hashKey(normalizeKeyBody(PLAINTEXT)!));
    expect(hashKey(BODY)).toHaveLength(64);
    expect(hashKey(BODY)).not.toContain(BODY.slice(0, 5));
  });

  it('formats for display and round-trips back to the same body', () => {
    expect(formatKey(BODY)).toBe(PLAINTEXT);
    expect(normalizeKeyBody(formatKey(BODY))).toBe(BODY);
  });

  it('generates keys inside the alphabet, of the right length, and distinct', () => {
    const bodies = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const body = randomKeyBody();
      expect(body).toHaveLength(20);
      expect([...body].every((character) => ALPHABET.includes(character))).toBe(true);
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
