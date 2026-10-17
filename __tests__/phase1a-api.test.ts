/**
 * Unit tests for the direct-Firestore access layer. The rules themselves are exercised
 * against the emulator in __tests__/rules; this file covers the client's reading of the
 * two documents it touches — including the distinction between "the rules refused me"
 * (a verdict) and "the network failed" (a licence for offline grace).
 */
const MOCK_KEY_HASH = 'a'.repeat(64);
const KEY_PATH = `subscriptionKeys/${MOCK_KEY_HASH}`;

// jest hoists jest.mock() above the imports, so the state these factories close over is
// declared up front and named mock* to satisfy the out-of-scope-variable rule.
let mockStore: Record<string, Record<string, unknown> | null>;
let mockWrites: { path: string; data: Record<string, unknown>; merge: boolean }[];

const mockSnap = (path: string) => {
  const data = mockStore[path] ?? null;
  return { exists: () => data !== null, data: () => data };
};

const mockTx = {
  get: async (ref: { path: string }) => mockSnap(ref.path),
  set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
    mockWrites.push({ path: ref.path, data, merge: Boolean(options?.merge) });
    return mockTx;
  },
  update: (ref: { path: string }, data: Record<string, unknown>) => {
    mockWrites.push({ path: ref.path, data, merge: true });
    return mockTx;
  },
};

jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  doc: jest.fn((_db: unknown, coll: string, id: string) => ({ path: `${coll}/${id}` })),
  getDoc: jest.fn(async (ref: { path: string }) => mockSnap(ref.path)),
  runTransaction: jest.fn(
    async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  ),
}));
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn(() => ({ currentUser: { email: 'a@b.c', displayName: 'A', photoURL: null } })),
}));
jest.mock('expo-device', () => ({ modelName: 'Pixel 7' }));
jest.mock('@/src/firebase/init', () => ({
  ensureFirebase: jest.fn(() => true),
  currentUserUid: jest.fn(() => 'u1'),
}));
jest.mock('@/src/firebase/installation/installationId', () => ({
  getInstallationId: jest.fn(async () => 'inst-1'),
}));
jest.mock('@/src/firebase/subscriptions/digests', () => ({
  sha256Hex: async () => MOCK_KEY_HASH,
}));
jest.mock('@/src/utils/appVersion', () => ({ getAppVersion: () => '1.0.0' }));

import { ensureFirebase, currentUserUid } from '@/src/firebase/init';
import { activate, validate, TransportError } from '@/src/firebase/subscriptions/api';
import {
  keyOutcomeMessage,
  keyOutcomeOfActivateResult,
} from '@/src/firebase/subscriptions/keyOutcome';

const DAY = 86_400_000;
const NOWISH = Date.now();
const unusedKey = {
  keyHash: MOCK_KEY_HASH,
  status: 'UNUSED',
  durationDays: 30,
  createdAt: NOWISH - DAY,
};
const activeKey = { ...unusedKey, status: 'ACTIVE', uid: 'u1', expiresAt: NOWISH + 10 * DAY };

beforeEach(() => {
  mockStore = {};
  mockWrites = [];
  (ensureFirebase as jest.Mock).mockReturnValue(true);
  (currentUserUid as jest.Mock).mockReturnValue('u1');
});

const firestore = () => jest.requireMock('@react-native-firebase/firestore');
const writeFor = (path: string) => mockWrites.find((w) => w.path === path)?.data;
const throws = (code: string, message: string) => () => Promise.reject(new Error(`${code} ${message}`));

describe('validate', () => {
  it('reads needsKey for an account that has never activated', async () => {
    const r = await validate();
    expect(r.status).toBe('needsKey');
    expect(r.expiresAt).toBeNull();
  });

  it('honours a suspended or disabled account before looking at the key', async () => {
    mockStore['users/u1'] = { status: 'suspended', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + DAY };
    expect((await validate()).status).toBe('suspended');
    mockStore['users/u1'] = { status: 'disabled', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + DAY };
    expect((await validate()).status).toBe('disabled');
  });

  it('treats a revoked key as revoked even while the user document still looks active', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + 10 * DAY };
    mockStore[KEY_PATH] = { ...activeKey, status: 'REVOKED' };
    expect((await validate()).status).toBe('revoked');
  });

  it('applies whichever expiry comes first', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + 10 * DAY };
    mockStore[KEY_PATH] = { ...activeKey, expiresAt: NOWISH + DAY };
    const r = await validate();
    expect(r.status).toBe('authorized');
    expect(r.expiresAt).toBeLessThanOrEqual(NOWISH + DAY);
  });

  it('reports expired once the effective expiry has passed', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + DAY };
    mockStore[KEY_PATH] = { ...activeKey, expiresAt: NOWISH - 1000 };
    expect((await validate()).status).toBe('expired');
  });

  it('surfaces permission-denied as a refusal, not as transport', async () => {
    firestore().getDoc.mockImplementationOnce(throws('firestore/permission-denied', 'nope'));
    await expect(validate()).rejects.not.toBeInstanceOf(TransportError);
  });

  it('maps an unreachable Firestore onto TransportError so grace can apply', async () => {
    firestore().getDoc.mockImplementationOnce(throws('firestore/unavailable', 'down'));
    await expect(validate()).rejects.toBeInstanceOf(TransportError);
  });

  it('fails as transport when native config is missing', async () => {
    (ensureFirebase as jest.Mock).mockReturnValue(false);
    await expect(validate()).rejects.toBeInstanceOf(TransportError);
  });
});

describe('activate', () => {
  const KEY = '8JKM2-NPQRS-4T6VW-7XYZA';

  it('never reaches Firestore with a key it can already see is malformed', async () => {
    const r = await activate('not-a-key');
    expect(r.code).toBe('NOT_FOUND');
    expect(mockWrites).toHaveLength(0);
  });

  it('refuses to try at all when nobody is signed in', async () => {
    (currentUserUid as jest.Mock).mockReturnValue(null);
    expect((await activate(KEY)).code).toBe('UNAUTHENTICATED');
  });

  it('binds an unused key to the caller and stamps an expiry from the key duration', async () => {
    mockStore[KEY_PATH] = unusedKey;
    mockStore['users/u1'] = { status: 'active', installationId: 'inst-1', installationRotations: 0 };
    mockStore['config/app'] = { maxInstallationRotations: 5 };
    const r = await activate(KEY);
    expect(r.code).toBe('ACTIVATED');
    expect(r.expiresAt).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(writeFor(KEY_PATH)).toMatchObject({ status: 'ACTIVE', uid: 'u1', installationId: 'inst-1' });
    // Admin-owned fields have to survive the write, so binding must be a merge.
    expect(mockWrites.find((w) => w.path === KEY_PATH)?.merge).toBe(true);
    expect(writeFor('users/u1')).toMatchObject({ subscriptionId: MOCK_KEY_HASH, status: 'active' });
  });

  it('binds a sub-day key for the minutes it actually grants', async () => {
    // durationMs is authoritative. Rounding it up to durationDays here is what made a
    // four-minute key last a day, and the rules refuse that expiry outright.
    mockStore[KEY_PATH] = {
      ...unusedKey,
      durationDays: 1,
      durationMs: 4 * 60_000,
    };
    mockStore['users/u1'] = { status: 'active', installationId: 'inst-1', installationRotations: 0 };
    mockStore['config/app'] = { maxInstallationRotations: 5 };
    const before = Date.now();
    const r = await activate(KEY);
    expect(r.code).toBe('ACTIVATED');
    expect(r.durationMs).toBe(4 * 60_000);
    expect(r.durationDays).toBe(1);
    expect(r.expiresAt).toBeGreaterThanOrEqual(before + 4 * 60_000);
    expect(r.expiresAt).toBeLessThan(before + 5 * 60_000);
    expect(writeFor(KEY_PATH)).toMatchObject({ expiresAt: r.expiresAt });
  });

  it('grants the full day to a legacy key that carries no durationMs', async () => {
    mockStore[KEY_PATH] = { ...unusedKey, durationDays: 1 };
    mockStore['users/u1'] = { status: 'active', installationId: 'inst-1', installationRotations: 0 };
    mockStore['config/app'] = { maxInstallationRotations: 5 };
    const r = await activate(KEY);
    expect(r.code).toBe('ACTIVATED');
    expect(r.durationMs).toBe(DAY);
    expect(r.expiresAt).toBeGreaterThan(Date.now() + DAY - 60_000);
  });

  it('creates the user document from the auth profile when there is none', async () => {
    mockStore[KEY_PATH] = unusedKey;
    mockStore['config/app'] = { maxInstallationRotations: 5 };
    const r = await activate(KEY);
    expect(r.code).toBe('ACTIVATED');
    expect(writeFor('users/u1')).toMatchObject({ email: 'a@b.c', installationRotations: 0 });
    expect(writeFor('devices/u1__inst-1')).toMatchObject({ deviceModel: 'Pixel 7', rotatedAt: null });
  });

  it('is idempotent for the owner and distinguishable for somebody else', async () => {
    mockStore[KEY_PATH] = activeKey;
    mockStore['users/u1'] = { status: 'active', installationId: 'inst-1', installationRotations: 0 };
    expect((await activate(KEY)).code).toBe('ALREADY_OWNED');
    mockStore[KEY_PATH] = { ...activeKey, uid: 'someone-else' };
    expect((await activate(KEY)).code).toBe('ALREADY_BOUND');
  });

  it('reports a revoked or expired key instead of binding it', async () => {
    mockStore[KEY_PATH] = { ...unusedKey, status: 'REVOKED' };
    expect((await activate(KEY)).code).toBe('REVOKED');
    mockStore[KEY_PATH] = { ...unusedKey, status: 'EXPIRED' };
    expect((await activate(KEY)).code).toBe('EXPIRED');
    mockStore[KEY_PATH] = { ...unusedKey, expiresAt: Date.now() - 1 };
    expect((await activate(KEY)).code).toBe('EXPIRED');
    expect(mockWrites).toHaveLength(0);
  });

  it('refuses a second installation once the rotation counter is spent', async () => {
    mockStore[KEY_PATH] = unusedKey;
    mockStore['users/u1'] = {
      status: 'active',
      subscriptionId: 'other',
      installationId: 'old-inst',
      installationRotations: 2,
    };
    mockStore['config/app'] = { maxInstallationRotations: 2 };
    expect((await activate(KEY)).code).toBe('CEILING');
    expect(mockWrites).toHaveLength(0);
  });

  it('increments the rotation counter and closes out the previous device', async () => {
    mockStore[KEY_PATH] = unusedKey;
    mockStore['users/u1'] = {
      status: 'active',
      subscriptionId: 'other',
      installationId: 'old-inst',
      installationRotations: 0,
      activatedAt: NOWISH - DAY,
    };
    mockStore['config/app'] = { maxInstallationRotations: 5 };
    expect((await activate(KEY)).code).toBe('ACTIVATED');
    expect(writeFor('users/u1')).toMatchObject({ installationRotations: 1 });
    expect(writeFor('devices/u1__old-inst')).toMatchObject({ activatedAt: NOWISH - DAY });
    expect(writeFor('devices/u1__inst-1')).toMatchObject({ rotatedAt: null });
  });

  it('never reports a rules refusal as a network failure', async () => {
    mockStore[KEY_PATH] = unusedKey;
    mockStore['users/u1'] = { status: 'active', installationId: 'inst-1', installationRotations: 0 };
    mockStore['config/app'] = { maxInstallationRotations: 5 };
    firestore().runTransaction.mockImplementationOnce(
      () => Promise.reject(new Error('firestore/permission-denied Missing or insufficient permissions.')),
    );
    await expect(activate(KEY)).rejects.not.toBeInstanceOf(TransportError);
  });
});

/**
 * Owner's item 8 needs more than a code: it needs the observation the code was reached from.
 * The key document and `users/{uid}` both carry an `expiresAt`, they expire independently, and
 * an `EXPIRED` answer that cannot say which one ran out sends the user to buy a new key for
 * nothing. These cover what the client reports, not the arithmetic it already did.
 */
describe('whose expiry an expiry is', () => {
  const KEY = '8JKM2-NPQRS-4T6VW-7XYZA';

  it('names the key when the key document expires first', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + 10 * DAY };
    mockStore[KEY_PATH] = { ...activeKey, expiresAt: NOWISH - 3 * DAY };
    const r = await validate();
    expect(r.status).toBe('expired');
    expect(r.expiresAt).toBe(NOWISH - 3 * DAY);
    expect(r.expiryOwner).toBe('key');
  });

  it('names the account when the account term ended first and the key did not', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH - 3 * DAY };
    mockStore[KEY_PATH] = { ...activeKey, expiresAt: NOWISH + 10 * DAY };
    const r = await validate();
    expect(r.status).toBe('expired');
    expect(r.expiresAt).toBe(NOWISH - 3 * DAY);
    expect(r.expiryOwner).toBe('account');
  });

  it('names both when the two documents state the same instant', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH - DAY };
    mockStore[KEY_PATH] = { ...activeKey, expiresAt: NOWISH - DAY };
    const r = await validate();
    expect(r.expiryOwner).toBe('both');
  });

  it('attributes the account when the key behind the account cannot be read at all', async () => {
    // The rules hide a key bound to somebody else, so the only expiry left is the account's.
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH - DAY };
    const r = await validate();
    expect(r.status).toBe('expired');
    expect(r.expiryOwner).toBe('account');
  });

  it('reports a staff-set EXPIRED key with the expiry that document carries', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + 10 * DAY };
    mockStore[KEY_PATH] = { ...activeKey, status: 'EXPIRED', expiresAt: NOWISH - 2 * DAY };
    const r = await validate();
    expect(r.status).toBe('expired');
    expect(r.expiresAt).toBe(NOWISH - 2 * DAY);
    expect(r.expiryOwner).toBe('key');
  });

  it('invents no timestamp for an EXPIRED key that never recorded one', async () => {
    mockStore['users/u1'] = { status: 'active', subscriptionId: MOCK_KEY_HASH, expiresAt: NOWISH + 10 * DAY };
    mockStore[KEY_PATH] = { ...activeKey, status: 'EXPIRED', expiresAt: null };
    const r = await validate();
    expect(r.status).toBe('expired');
    expect(r.expiresAt).toBeNull();
    expect(r.expiryOwner).toBe('unknown');
  });

  it('says nothing about time when the account itself is suspended', async () => {
    mockStore['users/u1'] = {
      status: 'suspended',
      subscriptionId: MOCK_KEY_HASH,
      expiresAt: NOWISH + DAY,
    };
    const r = await validate();
    expect(r.status).toBe('suspended');
    expect(r.expiresAt).toBeNull();
    expect(r.expiryOwner).toBe('unknown');
  });

  it('hands an EXPIRED activation the key document own expiry', async () => {
    mockStore[KEY_PATH] = { ...unusedKey, status: 'EXPIRED', expiresAt: NOWISH - 2 * DAY };
    const r = await activate(KEY);
    expect(r.code).toBe('EXPIRED');
    expect(r.expiresAt).toBe(NOWISH - 2 * DAY);
    // A refusal granted no term, so it must not pretend to have one.
    expect(r.durationDays).toBeNull();
    expect(r.durationMs).toBeNull();
    expect(mockWrites).toHaveLength(0);
  });

  it('still calls a zero expiry an expiry, and hands the screen a value it cannot misuse', async () => {
    // An `expiresAt` of 0 is a legacy or hand-edited document, not the epoch. The verdict stays
    // EXPIRED — the field really is not in the future — but the timestamp is meaningless, and
    // the mapping is required to fall back to the plain sentence instead of computing
    // "expired 56 years ago".
    mockStore[KEY_PATH] = { ...unusedKey, expiresAt: 0 };
    const r = await activate(KEY);
    expect(r.code).toBe('EXPIRED');
    expect(r.expiresAt).toBe(0);
    expect(keyOutcomeMessage(keyOutcomeOfActivateResult(r))).toBe('This key has expired.');
  });
});
