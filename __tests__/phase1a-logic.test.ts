import vectors from '../fixtures/keyNormalization.json';
import {
  formatKeyForDisplay,
  formatKeyInput,
  looksPlausible,
  normalizeKeyBody,
} from '@/src/firebase/subscriptions/keyFormat';
import { decideGate, routeFor, shouldRevalidate } from '@/src/firebase/subscriptions/gate';
import { describeActivation, describeAuthError, isTransportError } from '@/src/firebase/errors';
import type { AccessResult } from '@/src/firebase/models';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const ok: AccessResult = { status: 'authorized', expiresAt: NOW + DAY * 10, serverTimeMs: NOW };
const base = {
  uid: 'u1',
  live: null as AccessResult | null,
  transportFailed: false,
  lastGoodAuthorizedAt: null as number | null,
  nowMs: NOW,
  graceMs: DAY,
};

describe('keyFormat', () => {
  it.each(vectors.valid)('normalizes $raw', ({ raw, normalized }) => {
    expect(normalizeKeyBody(raw)).toBe(normalized);
    expect(looksPlausible(raw)).toBe(true);
    expect(formatKeyForDisplay(raw)).toBe(
      `FLK-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}-${normalized.slice(8, 12)}`,
    );
  });

  it.each(vectors.invalid)('rejects $raw', ({ raw }) => {
    expect(normalizeKeyBody(raw)).toBeNull();
    expect(looksPlausible(raw)).toBe(false);
  });

  it('never throws on hostile input', () => {
    for (const raw of ['', ' '.repeat(5000), "';DROP--", '\u0000\u0000', undefined as never, 42 as never]) {
      expect(() => formatKeyForDisplay(raw)).not.toThrow();
      expect(looksPlausible(raw)).toBe(false);
    }
  });

  it('groups typed input without destroying the value', () => {
    expect(formatKeyInput('7h3k')).toBe('FLK-7H3K');
    expect(formatKeyInput('flk-7h3k-92pq-x8km')).toBe('FLK-7H3K-92PQ-X8KM');
    expect(formatKeyInput('7H3K92PQX8KMZZZZ')).toBe('FLK-7H3K-92PQ-X8KM');
    expect(normalizeKeyBody(formatKeyInput('7h3k92pqx8km'))).toBe('7H3K92PQX8KM');
  });
});

describe('decideGate', () => {
  it('signedOut without a uid', () => expect(decideGate({ ...base, uid: null })).toBe('signedOut'));
  it('bootstrapping while the first verdict is pending', () => expect(decideGate(base)).toBe('bootstrapping'));
  it('ready on a live authorized verdict', () => expect(decideGate({ ...base, live: ok })).toBe('ready'));
  it('needsSubscription when no key was ever activated', () =>
    expect(decideGate({ ...base, live: { ...ok, status: 'needsKey' } })).toBe('needsSubscription'));

  it('blocks expired, revoked, suspended and disabled', () => {
    for (const status of ['expired', 'revoked', 'suspended', 'disabled', 'installationCeiling'] as const) {
      expect(decideGate({ ...base, live: { ...ok, status } })).toBe('blocked');
    }
  });

  it('blocks when the server says authorized but its clock shows expiry passed', () =>
    expect(
      decideGate({ ...base, live: { status: 'authorized', expiresAt: 1, serverTimeMs: NOW } }),
    ).toBe('blocked'));

  describe('offline grace', () => {
    const f = { ...base, transportFailed: true, lastGoodAuthorizedAt: NOW - 60_000 };
    it('admits a recent authorized verdict', () => expect(decideGate(f)).toBe('offlineCached'));
    it('refuses without any prior good verdict', () =>
      expect(decideGate({ ...f, lastGoodAuthorizedAt: null })).toBe('needsServerContact'));
    it('refuses past the grace window', () =>
      expect(decideGate({ ...f, lastGoodAuthorizedAt: NOW - DAY - 1 })).toBe('needsServerContact'));
    it('never lets a live revoked verdict be rescued by the cache', () =>
      expect(decideGate({ ...f, live: { ...ok, status: 'revoked' } })).toBe('blocked'));
  });
});

describe('routeFor and shouldRevalidate', () => {
  it('maps every decision to a route', () => {
    expect(routeFor('signedOut')).toBe('Login');
    expect(routeFor('needsSubscription')).toBe('Subscription');
    expect(routeFor('ready')).toBe('Main');
    expect(routeFor('offlineCached')).toBe('Main');
    expect(routeFor('blocked')).toBe('Blocked');
    expect(routeFor('bootstrapping')).toBe('Blocked');
    expect(routeFor('needsServerContact')).toBe('Blocked');
  });
  it('always revalidates when never validated', () =>
    expect(shouldRevalidate(null, NOW, 900_000)).toBe(true));
  it('revalidates only past the interval', () => {
    expect(shouldRevalidate(NOW - 901_000, NOW, 900_000)).toBe(true);
    expect(shouldRevalidate(NOW - 10_000, NOW, 900_000)).toBe(false);
  });
});

describe('error copy', () => {
  it('gives every activation code user-facing text with no SDK leakage', () => {
    const codes = ['ACTIVATED', 'ALREADY_OWNED', 'NOT_FOUND', 'EXPIRED', 'REVOKED', 'ALREADY_BOUND', 'CEILING', 'UNAUTHENTICATED'] as const;
    for (const code of codes) {
      const message = describeActivation(code);
      expect(message.length).toBeGreaterThan(12);
      expect(message).not.toMatch(/Firebase|firestore|functions|\[object|undefined/);
    }
    expect(describeActivation('NOT_FOUND')).toMatch(/isn't valid/i);
    expect(describeActivation('ALREADY_BOUND')).toMatch(/another account/i);
    expect(describeActivation('EXPIRED')).toMatch(/expired/i);
    expect(describeActivation('REVOKED')).toMatch(/revoked/i);
  });

  it('separates cancellation from failure', () => {
    expect(describeAuthError('cancel')).toMatch(/cancelled/i);
    expect(describeAuthError('network-request-failed')).toMatch(/connection/i);
    expect(describeAuthError('mystery-code')).toBe('Sign-in failed. Please try again.');
  });

  it('classifies only real transport failures', () => {
    expect(isTransportError({ code: 'unavailable' })).toBe(true);
    expect(isTransportError({ code: 'functions/internal' })).toBe(true);
    expect(isTransportError({ code: 'permission-denied' })).toBe(false);
    expect(isTransportError(new Error('boom'))).toBe(false);
    expect(isTransportError(undefined)).toBe(false);
  });
});
