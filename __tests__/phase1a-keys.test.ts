/**
 * Three runtimes implement the same key grammar: StreamZ Admin (Kotlin), the user app
 * (TypeScript) and the undeployed functions project. This suite is the referee — all
 * read the same fixture, so drift fails here instead of producing keys a user can type
 * and the database cannot find.
 *
 * The second half of this file referees a different drift: what the app *says* about a key.
 * Owner's item 8 requires the reported state to be the state the backend actually observed,
 * so every observed state has to map to exactly one distinct sentence, and no sentence may
 * ever claim more than Firestore rules can answer.
 */
import { createHash } from 'crypto';
import vectors from '../fixtures/keyNormalization.json';
import { formatKey, hashKey, normalizeKeyBody, randomKeyBody } from '../functions/src/keys';
import {
  keyOutcomeMessage,
  keyOutcomeOfAccess,
  keyOutcomeOfActivateResult,
  keyOutcomeOfGate,
  keyOutcomeOfThrown,
  keyOutcomeStatus,
  type KeyOutcomeFacts,
  type KeyState,
} from '@/src/firebase/subscriptions/keyOutcome';
import { describeActivation } from '@/src/firebase/errors';
import type { AccessResult, ActivateCode, ActivateResult } from '@/src/firebase/models';

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

// ---------------------------------------------------------------------------
// What the app is allowed to SAY about a key (owner's item 8).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const MIN = 60_000;
// A fixed clock for the pure mapping, so "3 days ago" is a fact under test rather than a race.
const NOW = Date.UTC(2026, 9, 20, 12);
const EXPIRED_3_DAYS = NOW - 3 * DAY;

/** The error shape @react-native-firebase/firestore rejects a refused read with. */
const rulesRefusal = () => {
  const e = new Error('firestore/permission-denied Missing or insufficient permissions.');
  (e as Error & { code: string }).code = 'firestore/permission-denied';
  return e;
};

/** Every state the app can observe, in one list. A new state must be added here too. */
const ALL_STATES: KeyState[] = [
  'ACTIVATED',
  'ALREADY_OWNED',
  'NOT_FOUND',
  'EXPIRED',
  'REVOKED',
  'ALREADY_BOUND',
  'CEILING',
  'UNAUTHENTICATED',
  'CHECK_UNREACHABLE',
  'CHECK_REFUSED',
  'CHECK_UNEXPECTED',
  'CHECK_PENDING',
  'VERDICT_UNUSABLE',
  'SUBSCRIPTION_ACTIVE',
  'NO_KEY_ON_ACCOUNT',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DISABLED',
];

/** The state as a screen would actually receive it: EXPIRED always knows whose expiry it read. */
const factsFor = (state: KeyState): KeyOutcomeFacts => ({
  state,
  expiresAt: state === 'EXPIRED' ? EXPIRED_3_DAYS : null,
  expiryOwner: state === 'EXPIRED' ? 'key' : 'unknown',
  nowMs: NOW,
});

const activateResult = (over: Partial<ActivateResult> & { code: ActivateCode }): ActivateResult => ({
  expiresAt: null,
  durationDays: null,
  durationMs: null,
  ...over,
});

const verdictOf = (over: Partial<AccessResult> & { status: AccessResult['status'] }): AccessResult => ({
  expiresAt: null,
  serverTimeMs: NOW,
  ...over,
});

describe('every observed key state maps to exactly one distinct message', () => {
  it('gives each state its own sentence, and no two states share one', () => {
    const details = ALL_STATES.map((state) => keyOutcomeMessage(factsFor(state)));
    expect(details).toHaveLength(ALL_STATES.length);
    expect(new Set(details).size).toBe(ALL_STATES.length);
    // The one-line status register the Settings card draws has to stay just as unambiguous.
    const statuses = ALL_STATES.map((state) => keyOutcomeStatus(factsFor(state)));
    expect(new Set(statuses).size).toBe(ALL_STATES.length);
  });

  it('is deterministic, so a screen re-rendering cannot restate the verdict', () => {
    for (const state of ALL_STATES) {
      expect(keyOutcomeMessage(factsFor(state))).toBe(keyOutcomeMessage(factsFor(state)));
    }
  });

  it('says something a user can act on, and nothing about the backend', () => {
    for (const state of ALL_STATES) {
      const message = keyOutcomeMessage(factsFor(state));
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/Firebase|firestore|functions|subscriptionKeys|\[object|undefined|NaN/);
      expect(message).toMatch(/[a-z]/);
    }
  });

  it('falls back to support copy for a state it was never told about', () => {
    const unknown = keyOutcomeMessage({ state: 'NOT_A_STATE' as unknown as KeyState });
    expect(unknown).toMatch(/Contact support/i);
    expect(ALL_STATES.map((state) => keyOutcomeMessage(factsFor(state)))).not.toContain(unknown);
  });

  it('routes the activation codes through the same mapping the screens use', () => {
    for (const code of ['ACTIVATED', 'ALREADY_OWNED', 'NOT_FOUND', 'EXPIRED', 'REVOKED',
                        'ALREADY_BOUND', 'CEILING', 'UNAUTHENTICATED'] as const) {
      // An activation code always names the key document, because that is the only document
      // the transaction reads before it refuses.
      expect(describeActivation(code)).toBe(
        keyOutcomeMessage({ state: code, expiryOwner: code === 'EXPIRED' ? 'key' : 'unknown' }),
      );
    }
    expect(describeActivation('EXPIRED', Date.now() - 3 * DAY - MIN)).toBe('This key expired 3 days ago.');
    expect(describeActivation('EXPIRED')).toBe('This key has expired.');
  });
});

describe('no key outcome may ever repeat the key back', () => {
  const spellings = [
    BODY,
    PLAINTEXT,
    PLAINTEXT.toLowerCase(),
    `SZ-${PLAINTEXT}`,
    `FLK-${PLAINTEXT}`,
    hashKey(BODY),
    hashKey(BODY).slice(0, 16),
  ];

  it('keeps the plaintext, its groups and its hash out of every sentence', () => {
    const outcomes = [
      ...ALL_STATES.map(factsFor),
      keyOutcomeOfActivateResult(activateResult({ code: 'NOT_FOUND' })),
      keyOutcomeOfActivateResult(activateResult({ code: 'EXPIRED', expiresAt: NOW - 3 * DAY })),
      keyOutcomeOfAccess(verdictOf({ status: 'expired', expiresAt: NOW - 3 * DAY, expiryOwner: 'key' })),
      keyOutcomeOfAccess(verdictOf({ status: 'revoked' })),
      keyOutcomeOfThrown(new Error('firestore/permission-denied Missing or insufficient permissions.')),
      keyOutcomeOfThrown(new Error('firestore/unavailable Offline')),
    ];
    for (const facts of outcomes) {
      for (const message of [keyOutcomeMessage(facts), keyOutcomeStatus(facts)]) {
        for (const spelling of spellings) {
          expect(message).not.toContain(spelling);
        }
      }
    }
  });

  it('does not accept a plaintext key as an argument at all', () => {
    // The mapping takes one facts object: a state, an authoritative timestamp, and whose
    // timestamp it was. There is no parameter a key could leak through, which is why this
    // holds for every message added later as well as the ones written today.
    expect(keyOutcomeMessage.length).toBe(1);
  });
});

describe('expiry is reported with the duration the documents actually state', () => {
  it('says how long ago when the key document gave an expiry', () => {
    expect(keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt: EXPIRED_3_DAYS, nowMs: NOW }))
      .toBe('This key expired 3 days ago.');
    expect(keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt: NOW - (90 * MIN), nowMs: NOW }))
      .toBe('This key expired 1 h 30 min ago.');
    expect(keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt: NOW - 26 * MIN, nowMs: NOW }))
      .toBe('This key expired 26 min ago.');
  });

  it('says nothing about duration when the expiry is unavailable', () => {
    for (const missing of [null, undefined, Number.NaN, '2026-10-17' as unknown as number]) {
      const message = keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt: missing, nowMs: NOW });
      expect(message).toBe('This key has expired.');
    }
  });

  it('refuses to print a negative, a zero, or a future expiry', () => {
    // A timestamp ahead of the clock it is compared with is not an expiry, and an implausible
    // one (epoch zero, a unit error) is not a duration anyone should be shown.
    const cases: (number | null)[] = [NOW + DAY, NOW, 0, -1, 1, Date.UTC(1970, 0, 1), NOW - 40 * 365 * DAY];
    for (const expiresAt of cases) {
      const message = keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt, nowMs: NOW });
      expect(message).toBe('This key has expired.');
      expect(message).not.toMatch(/ago/);
      expect(message).not.toMatch(/-/);
    }
  });

  it('never rounds a sub-minute gap up into a duration that has not passed', () => {
    expect(keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt: NOW - 40_000, nowMs: NOW }))
      .toBe('This key has expired.');
  });

  it('attributes the expiry to the document that actually stated it', () => {
    const key = keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'key', expiresAt: EXPIRED_3_DAYS, nowMs: NOW });
    const account = keyOutcomeMessage({
      state: 'EXPIRED',
      expiryOwner: 'account',
      expiresAt: EXPIRED_3_DAYS,
      nowMs: NOW,
    });
    const both = keyOutcomeMessage({ state: 'EXPIRED', expiryOwner: 'both', expiresAt: EXPIRED_3_DAYS, nowMs: NOW });
    const unclear = keyOutcomeMessage({
      state: 'EXPIRED',
      expiryOwner: 'unknown',
      expiresAt: EXPIRED_3_DAYS,
      nowMs: NOW,
    });
    expect(new Set([key, account, both, unclear]).size).toBe(4);
    // The owner's complaint: a term that ended on the account used to be reported as the key
    // running out, which sends the user to buy a new key for nothing.
    expect(account).toMatch(/account/i);
    expect(account).toMatch(/key itself/i);
    expect(key).not.toMatch(/account/i);
    expect(unclear).not.toMatch(/account/i);
    expect(unclear).not.toMatch(/\bkey\b/i);
  });

  it('reads the attribution from the live verdict rather than guessing it', () => {
    expect(
      keyOutcomeMessage(
        keyOutcomeOfAccess(verdictOf({ status: 'expired', expiresAt: EXPIRED_3_DAYS, expiryOwner: 'account' })),
      ),
    ).toMatch(/account/i);
    // A verdict that knows when but not whose: still a duration, still no attribution.
    expect(
      keyOutcomeMessage(keyOutcomeOfAccess(verdictOf({ status: 'expired', expiresAt: EXPIRED_3_DAYS }))),
    ).toBe('This subscription expired 3 days ago.');
    // A verdict that knows neither: the plain sentence, and nothing invented.
    expect(
      keyOutcomeMessage(keyOutcomeOfAccess(verdictOf({ status: 'expired', expiryOwner: 'unknown' }))),
    ).toBe('This subscription has expired.');
  });

  it('takes the duration from what the activation transaction actually read', () => {
    // `activate()` hands back the key document's own `expiresAt` on an EXPIRED refusal, so the
    // screen can say how long ago without the device guessing at a date it never saw.
    const threeDaysAndAMinute = Date.now() - 3 * DAY - MIN;
    expect(
      keyOutcomeMessage(keyOutcomeOfActivateResult(activateResult({ code: 'EXPIRED', expiresAt: threeDaysAndAMinute }))),
    ).toBe('This key expired 3 days ago.');
    expect(
      keyOutcomeMessage(keyOutcomeOfActivateResult(activateResult({ code: 'EXPIRED' }))),
    ).toBe('This key has expired.');
  });
});

describe('a check that failed is never reported as a key that is wrong', () => {
  const invalidity = /invalid|isn't valid|not valid|bogus|fake|expired|revoked|not recognised|unauthor/i;

  it.each([
    ['offline device', new Error('firestore/unavailable Failed to reach the Firestore backend')],
    ['read timeout', new Error('firestore/deadline-exceeded Timed out')],
    ['TransportError shape', { name: 'TransportError', code: 'unavailable', message: 'transport' }],
    ['native network failure', new Error('network-request-failed No connection')],
    ['server over load', new Error('firestore/resource-exhausted Quota')],
  ])('classifies %s as a retry, not a verdict', (_label, e) => {
    const message = keyOutcomeMessage(keyOutcomeOfThrown(e));
    expect(message).toMatch(/couldn't reach|try again/i);
    expect(message).toMatch(/nothing was activated/i);
    expect(message).not.toMatch(invalidity);
  });

  it('reports a rules refusal as a refusal, and not as "key not found"', () => {
    const message = keyOutcomeMessage(keyOutcomeOfThrown(rulesRefusal()));
    expect(message).toBe(keyOutcomeMessage({ state: 'CHECK_REFUSED' }));
    expect(message).not.toBe(keyOutcomeMessage({ state: 'NOT_FOUND' }));
    expect(message).toMatch(/couldn't be completed/i);
    expect(message).toMatch(/try again|contact support/i);
    expect(message).not.toMatch(/isn't valid|not recognised|has expired|been revoked/i);
    // A refusal must not be dressed up as the one state it most resembles.
    expect(message).toMatch(/another account/i);
  });

  it('keeps transport and refusal as two different messages', () => {
    expect(keyOutcomeOfThrown(new Error('firestore/unavailable down')).state)
      .not.toBe(keyOutcomeOfThrown(rulesRefusal()).state);
    expect(keyOutcomeMessage(keyOutcomeOfThrown(new Error('firestore/unavailable down'))))
      .not.toBe(keyOutcomeMessage(keyOutcomeOfThrown(rulesRefusal())));
  });

  it('gives an unrecognised throw its own sentence instead of borrowing NOT_FOUND', () => {
    const message = keyOutcomeMessage(keyOutcomeOfThrown(new Error('something went odd here')));
    expect(message).toBe(keyOutcomeMessage({ state: 'CHECK_UNEXPECTED' }));
    expect(message).not.toBe(keyOutcomeMessage({ state: 'NOT_FOUND' }));
    expect(message).not.toMatch(invalidity);
  });

  it('says so when there is no verdict yet, rather than picking a negative', () => {
    const pending = keyOutcomeMessage(keyOutcomeOfGate('bootstrapping', null));
    expect(pending).toMatch(/still checking|no verdict/i);
    expect(pending).not.toMatch(invalidity);
    expect(keyOutcomeMessage(keyOutcomeOfAccess(null))).toBe(pending);
  });

  it('routes the blocked stack through the mapping, so a pending check is not "revoked"', () => {
    const revoked = keyOutcomeMessage({ state: 'REVOKED' });
    for (const decision of ['bootstrapping', 'needsServerContact'] as const) {
      expect(keyOutcomeMessage(keyOutcomeOfGate(decision, null))).not.toBe(revoked);
    }
    expect(keyOutcomeMessage(keyOutcomeOfGate('blocked', verdictOf({ status: 'suspended' }))))
      .toBe(keyOutcomeMessage({ state: 'ACCOUNT_SUSPENDED' }));
  });
});

describe('already-owned and already-bound stay two different answers', () => {
  const owned = keyOutcomeMessage({ state: 'ALREADY_OWNED' });
  const bound = keyOutcomeMessage({ state: 'ALREADY_BOUND' });

  it('offers this account a way in and that key a different outcome', () => {
    expect(owned).not.toBe(bound);
    expect(owned).toMatch(/your account/i);
    expect(owned).toMatch(/carry on|continue/i);
    expect(bound).toMatch(/another account/i);
    expect(bound).toMatch(/different key|new key|support/i);
    // The two must not be readable as each other.
    expect(owned).not.toMatch(/another account|can't be activated/i);
    expect(bound).not.toMatch(/already active on your account|carry on/i);
  });

  it('does not claim to know whose key a refusal was, because the rules hide that', () => {
    // `ALREADY_BOUND` is only reachable for a caller the rules let read another account's key.
    // Everybody else's attempt arrives as a refusal, and the refusal says both possibilities.
    const refusal = keyOutcomeMessage({ state: 'CHECK_REFUSED' });
    expect(refusal).not.toMatch(/^This key (is|has) already been used/i);
    expect(refusal).toMatch(/both|either/i);
  });
});

describe('states the backend does not have are not reported', () => {
  it('calls suspended and disabled account states, never key states', () => {
    // KeyStatus is UNUSED | ACTIVE | EXPIRED | REVOKED, and firestore.rules refuses any other
    // value on a staff update, so "key suspended" was never a thing the ledger could say.
    for (const state of ['ACCOUNT_SUSPENDED', 'ACCOUNT_DISABLED'] as const) {
      const message = keyOutcomeMessage({ state });
      expect(message).toMatch(/account/i);
      expect(message).not.toMatch(/key (is |was |has been )?(suspended|disabled)/i);
      expect(keyOutcomeStatus({ state })).toMatch(/Account/i);
    }
  });

  it('never invents a suspension or disablement of the key itself', () => {
    for (const state of ALL_STATES) {
      expect(keyOutcomeMessage(factsFor(state))).not.toMatch(/key (is |was |has been )?(suspended|disabled)/i);
    }
  });
});
