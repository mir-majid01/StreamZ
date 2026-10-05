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
