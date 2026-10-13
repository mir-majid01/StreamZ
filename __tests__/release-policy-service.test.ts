/**
 * The device side of the release policy: what a read can produce, and what the
 * app is then allowed to conclude. The Firestore call and the local cache are
 * mocked here — `__tests__/rules` covers the server half.
 */
jest.mock('@react-native-firebase/firestore', () => ({
  doc: jest.fn(((_db: unknown, path: string, id: string) => ({ path, id })) as never),
  getDoc: jest.fn(),
  getFirestore: jest.fn(() => ({ appName: '[DEFAULT]' })),
}));

jest.mock('@/src/firebase/init', () => ({
  ensureFirebase: jest.fn(() => true),
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      setItem: jest.fn((k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve();
      }),
      removeItem: jest.fn((k: string) => {
        store.delete(k);
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store.clear();
        return Promise.resolve();
      }),
      __store: store,
    },
  };
});

jest.mock('@/src/utils/appVersion', () => ({
  getAppVersion: jest.fn(() => '0.1.0'),
  getInstalledAppVersion: jest.fn(() => '0.1.0'),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDoc } from '@react-native-firebase/firestore';
import { ensureFirebase } from '@/src/firebase/init';
import { isReleasePolicy } from '@/src/utils/releasePolicy';
import {
  classifyPolicyError,
  evaluateReleasePolicy,
  readReleasePolicy,
} from '@/src/firebase/release/policy';

const SHA = 'a'.repeat(64);
const CERT = 'b'.repeat(64);

const POLICY_DOC = {
  minimumSupportedVersion: '0.2.0',
  latestVersion: '0.3.0',
  apkUrl: 'https://github.com/mir-majid01/StreamZ/releases/download/v0.3.0/app-release.apk',
  apkSha256: SHA,
  signingCertSha256: CERT,
  releaseNotes: 'fixes',
  apkSizeBytes: 1000,
};

const existsSnap = (data: unknown) => ({ exists: () => true, data: () => data });
const missingSnap = () => ({ exists: () => false, data: () => undefined });

const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), {
  code: 'permission-denied',
});

const mockGetDoc = (impl: () => unknown) =>
  (getDoc as jest.Mock).mockImplementation(async () => impl());

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (ensureFirebase as jest.Mock).mockReturnValue(true);
});

describe('classifyPolicyError', () => {
  it('keeps a rules refusal distinct from an outage', () => {
    expect(classifyPolicyError(denied())).toBe('forbidden');
    expect(classifyPolicyError({ code: 'unavailable' })).toBe('unreachable');
    expect(classifyPolicyError(new Error('network'))).toBe('unreachable');
  });
});

describe('readReleasePolicy', () => {
  it('reports a document that is not there as missing, not as an outage', async () => {
    mockGetDoc(missingSnap);
    expect(await readReleasePolicy()).toEqual({ outcome: 'missing', policy: null });
  });

  it('reports a permission refusal as forbidden', async () => {
    mockGetDoc(() => {
      throw denied();
    });
    expect((await readReleasePolicy()).outcome).toBe('forbidden');
  });

  it('reports a document that exists but cannot be trusted as malformed', async () => {
    mockGetDoc(() => existsSnap({ ...POLICY_DOC, apkSha256: 'nope' }));
    expect((await readReleasePolicy()).outcome).toBe('malformed');
  });

  it('refuses to treat an unavailable Firebase app as "no update published"', async () => {
    (ensureFirebase as jest.Mock).mockReturnValue(false);
    expect((await readReleasePolicy()).outcome).toBe('unreachable');
  });
});

describe('isReleasePolicy', () => {
  it('rejects a Firestore-shaped document, which is not the cached shape', () => {
    // The cache stores the parsed policy (`sha256`, `downloadUrl`), not the raw
    // document (`apkSha256`, `apkUrl`). Reading one as the other silently disables
    // the offline gate, because validation fails and the entry is dropped.
    expect(isReleasePolicy(POLICY_DOC)).toBe(false);
    expect(
      isReleasePolicy({
        minimumSupportedVersion: '0.2.0',
        latestVersion: '0.3.0',
        releaseNotes: '',
        publishedAt: null,
        downloadUrl: POLICY_DOC.apkUrl,
        sha256: SHA,
        sizeBytes: 1000,
        signingCertSha256: CERT,
      }),
    ).toBe(true);
  });
});

describe('evaluateReleasePolicy', () => {
  it('does not block a device when nothing authoritative was read', async () => {
    mockGetDoc(missingSnap);
    const d = await evaluateReleasePolicy();
    expect(d.verdict).toBe('unknown');
    expect(d.blocks).toBe(false);
  });

  it('blocks when the installed version is under the published minimum', async () => {
    mockGetDoc(() => existsSnap(POLICY_DOC));
    const d = await evaluateReleasePolicy();
    expect(d.verdict).toBe('mandatory');
    expect(d.blocks).toBe(true);
    expect(d.fromCache).toBe(false);
  });

  it('caches a good policy and uses it while offline, inside the grace window', async () => {
    mockGetDoc(() => existsSnap(POLICY_DOC));
    await evaluateReleasePolicy();
    const raw = await AsyncStorage.getItem('streamz.releasePolicy.v1');
    expect(raw).toBeTruthy();

    mockGetDoc(() => {
      throw Object.assign(new Error('offline'), { code: 'unavailable' });
    });
    const d = await evaluateReleasePolicy();
    expect(d.verdict).toBe('mandatory');
    expect(d.fromCache).toBe(true);
    expect(d.blocks).toBe(true);
  });

  it('lets the cache expire instead of gating a device forever', async () => {
    mockGetDoc(() => existsSnap(POLICY_DOC));
    await evaluateReleasePolicy();

    // Age the stored entry past the grace window, then lose the network.
    const key = 'streamz.releasePolicy.v1';
    const stored = JSON.parse((await AsyncStorage.getItem(key))!);
    stored.fetchedAtMs = Date.now() - 73 * 3_600_000;
    await AsyncStorage.setItem(key, JSON.stringify(stored));

    mockGetDoc(() => {
      throw Object.assign(new Error('offline'), { code: 'unavailable' });
    });
    const d = await evaluateReleasePolicy();
    expect(d.fromCache).toBe(false);
    expect(d.verdict).toBe('unknown');
    expect(d.blocks).toBe(false);
  });

  it('will not honour the cache across a rules change or a withdrawal', async () => {
    mockGetDoc(() => existsSnap(POLICY_DOC));
    await evaluateReleasePolicy();

    const refusals: Array<() => unknown> = [
      // The rules moved.
      () => {
        throw denied();
      },
      // The owner withdrew the release.
      () => missingSnap(),
    ];
    for (const impl of refusals) {
      mockGetDoc(impl);
      const d = await evaluateReleasePolicy();
      expect(d.fromCache).toBe(false);
      expect(d.verdict).toBe('unknown');
      expect(d.blocks).toBe(false);
    }
  });

  it('does not write a cache entry from a failed read', async () => {
    mockGetDoc(() => {
      throw denied();
    });
    await evaluateReleasePolicy();
    expect(await AsyncStorage.getItem('streamz.releasePolicy.v1')).toBeNull();
  });
});
