import vectors from '../fixtures/keyNormalization.json';
import {
  formatKeyForDisplay,
  formatKeyInput,
  looksPlausible,
  normalizeKeyBody,
} from '@/src/firebase/subscriptions/keyFormat';
import { decideGate, gateResetFor, routeFor, shouldRevalidate } from '@/src/firebase/subscriptions/gate';
import {
  describeActivation,
  describeAuthError,
  describeFirestoreError,
  isTransportError,
} from '@/src/firebase/errors';
import { CONFIG_DEFAULTS, graceMsFrom, staleMsFrom, type AccessResult } from '@/src/firebase/models';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const ok: AccessResult = { status: 'authorized', expiresAt: NOW + DAY * 10, serverTimeMs: NOW };
const base = {
  uid: 'u1',
  liveUid: 'u1',
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
      [0, 5, 10, 15].map((start) => normalized.slice(start, start + 5)).join('-'),
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
    expect(formatKeyInput('8jkm')).toBe('8JKM');
    expect(formatKeyInput('8jkm2npqrs4t6vw7xyza')).toBe('8JKM2-NPQRS-4T6VW-7XYZA');
    expect(formatKeyInput('SZ-8JKM2-NPQRS-4T6VW-7XYZA')).toBe('8JKM2-NPQRS-4T6VW-7XYZA');
    expect(formatKeyInput('FLK-8JKM2-NPQRS-4T6VW-7XYZA')).toBe('8JKM2-NPQRS-4T6VW-7XYZA');
    expect(normalizeKeyBody(formatKeyInput('8jkm 2npqr s4t6v w7xy za'))).toBe('8JKM2NPQRS4T6VW7XYZA');
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
    expect(describeActivation('ALREADY_BOUND')).toMatch(/another account/i);
    expect(describeActivation('EXPIRED')).toMatch(/expired/i);
    expect(describeActivation('REVOKED')).toMatch(/revoked/i);
  });

  it('reports an unrecognised key as unrecognised, never as invalid', () => {
    // Reverses the old `NOT_FOUND` assertion, which demanded the wording "isn't valid". The
    // app cannot tell a key that was never minted from one the rules hide from this caller —
    // and closing that gap for a signed-in device would be a key-existence oracle over the
    // whole keyspace — so the honest sentence is "we couldn't match it", and "invalid" is a
    // claim the backend never made. The negative assertion is the point: it is what keeps a
    // future edit from sliding back into the wording that hid the truth from users.
    const notFound = describeActivation('NOT_FOUND');
    expect(notFound).toMatch(/couldn't match|we're allowed to see/i);
    expect(notFound).not.toMatch(/invalid|isn't valid|not valid|bogus|fake|expired|revoked/i);
    // A transport failure and a rules refusal are not this sentence either.
    expect(describeFirestoreError('unavailable')).not.toBe(notFound);
    expect(describeFirestoreError('permission-denied')).not.toBe(notFound);
    expect(describeFirestoreError('permission-denied')).toMatch(/completed|check/i);
    expect(describeFirestoreError('permission-denied')).not.toMatch(/invalid|isn't valid/i);
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

// Regression tests for the review findings on commit 85cb87f.
describe('decideGate regressions (review finding 1, 3, 6, 9)', () => {
  const graceBase = { ...base, transportFailed: true, lastGoodAuthorizedAt: NOW - 60_000 };

  it('does not let a cached authorized verdict outrank the grace window', () => {
    expect(decideGate({ ...graceBase, live: ok })).toBe('offlineCached');
  });

  it('drops an authorized verdict to needsServerContact once grace is exhausted', () => {
    expect(decideGate({ ...graceBase, live: ok, lastGoodAuthorizedAt: NOW - DAY - 1 }))
      .toBe('needsServerContact');
  });

  it.each(['expired', 'revoked', 'suspended', 'disabled', 'installationCeiling'] as const)(
    'a live %s verdict is never rescued by fresh grace',
    (status) => {
      expect(decideGate({ ...graceBase, live: { ...ok, status } })).toBe('blocked');
    },
  );

  it('refuses to honour a verdict issued for a different account', () => {
    expect(decideGate({ ...base, uid: 'u2', liveUid: 'u1', live: ok })).toBe('bootstrapping');
  });

  it('does not trust a future-dated cache entry', () => {
    expect(decideGate({ ...base, transportFailed: true, lastGoodAuthorizedAt: NOW + DAY }))
      .toBe('needsServerContact');
  });

  it('blocks an authorized verdict that carries no expiry ceiling', () => {
    expect(decideGate({ ...base, live: { status: 'authorized', expiresAt: null, serverTimeMs: NOW } }))
      .toBe('blocked');
  });

  it('treats a stale server clock inside the verdict as expiry, not as grace', () => {
    expect(decideGate({ ...base, live: { ...ok, expiresAt: NOW - 1, serverTimeMs: NOW } }))
      .toBe('blocked');
  });
});

describe('units and round-trip (review findings 8, 15, 16)', () => {
  it('converts config minutes to gate milliseconds exactly once', () => {
    expect(graceMsFrom(CONFIG_DEFAULTS)).toBe(1440 * 60_000);
    expect(staleMsFrom(CONFIG_DEFAULTS)).toBe(10 * 60_000);
  });

  it.each(vectors.valid)('round-trips $raw through the input formatter', ({ raw, normalized }) => {
    expect(normalizeKeyBody(formatKeyInput(raw))).toBe(normalized);
  });

  it('documents the truncation contract for over-long input', () => {
    // 18 chars cleaned, one FLK prefix consumed, the remaining 15 shown as-is and never
    // accepted: a bare body is exactly 20 characters.
    expect(formatKeyInput('FLKFLK7H3K92PQX8KM')).toBe('FLK7H-3K92P-QX8KM');
    expect(looksPlausible(formatKeyInput('FLKFLK7H3K92PQX8KM'))).toBe(false);
  });

  it('rejects a prefixed body containing a character outside the alphabet', () => {
    for (const raw of ['FLK-8JKM2-NPQRS-4T6VW-7XYLI', 'SZ-0JKM2-NPQRS-4T6VW-7XYZA', '8JKM2-NPQRS-4T6VW-7XYZ1']) {
      expect(normalizeKeyBody(raw)).toBeNull();
    }
  });
});

// The gate is only enforcement if it reaches the stack from wherever the user is
// standing. Signing out from the Settings tab used to leave the app open because the
// old check compared against the *leaf* route, which is never a gate route.
describe('gateResetFor', () => {
  it('ejects a signed-out user standing on a tab inside Main', () => {
    expect(gateResetFor('Login', 'Settings')).toBe('Login');
    expect(gateResetFor('Login', 'Downloads')).toBe('Login');
  });
  it('ejects from a root-stack screen pushed deep into the app', () => {
    expect(gateResetFor('Login', 'MyList')).toBe('Login');
    expect(gateResetFor('Login', 'Player')).toBe('Login');
  });
  it('holds a revoked or grace-expired session from inside the app', () => {
    expect(gateResetFor('Blocked', 'Settings')).toBe('Blocked');
    expect(gateResetFor('Subscription', 'Home')).toBe('Subscription');
  });
  it('leaves ordinary in-app navigation alone while the session is Main', () => {
    for (const route of ['Main', 'Home', 'Detail', 'Player', 'Settings', 'MyList']) {
      expect(gateResetFor('Main', route)).toBeNull();
    }
  });
  it('moves a user off a gate screen the session no longer points at', () => {
    expect(gateResetFor('Main', 'Login')).toBe('Main');
    expect(gateResetFor('Subscription', 'Login')).toBe('Subscription');
    expect(gateResetFor('Blocked', 'Subscription')).toBe('Blocked');
  });
  it('does nothing when the stack already shows the gate route', () => {
    expect(gateResetFor('Login', 'Login')).toBeNull();
    expect(gateResetFor('Main', 'Main')).toBeNull();
  });
  it('never races Splash, which owns the first handoff', () => {
    expect(gateResetFor('Login', 'Splash')).toBeNull();
    expect(gateResetFor('Main', 'Splash')).toBeNull();
  });
  it('does nothing before navigation is ready', () => {
    expect(gateResetFor('Login', undefined)).toBeNull();
  });
});

describe('transport classification (review finding 4)', () => {
  it.each(['unavailable', 'internal', 'network-request-failed', 'deadline-exceeded',
           'resource-exhausted', 'unknown', 'functions/deadline-exceeded'])('%s is transport', (code) => {
    expect(isTransportError({ code })).toBe(true);
  });
  it.each(['permission-denied', 'unauthenticated', 'not-found', 'invalid-argument', 'cancel',
           'cancelled'])('%s is NOT transport', (code) => {
    expect(isTransportError({ code })).toBe(false);
  });
  it('falls back to support copy for an unknown activation code', () => {
    expect(describeActivation('NOPE' as never)).toMatch(/Contact support/i);
  });
});
