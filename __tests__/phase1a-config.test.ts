import { BRAND, LEGAL } from '@/src/config/brand';
import { FEATURES } from '@/src/config/features';
import {
  LIVE_TV_CONFIG,
  UPDATE_CONFIG,
  WATCH_PARTY_CONFIG,
  updateRepoConfigured,
  updatesActive,
} from '@/src/config/env';
import { isTVLayout } from '@/src/utils/tv';
import { CONFIG_DEFAULTS, type AccessResult, type UserDoc } from '@/src/firebase/models';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    setItemAsync: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
});
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE') }));

import { getInstallationId, INSTALLATION_KEY } from '@/src/firebase/installation/installationId';
import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

describe('brand config', () => {
  it('is the single source for identity and support', () => {
    expect(BRAND.name).toBe('StreamZ');
    expect(BRAND.supportEmail).toBe('Mirmajid@proton.me');
    expect(BRAND.supportTelegram).toBe('@Mirmajid01');
    expect(BRAND.applicationId).toBe('stream.z');
    expect(BRAND.accentHex).toBe('#E50914');
    expect(BRAND.scheme).toBe('streamz');
  });

  it('keeps the GPL attribution obligations', () => {
    expect(LEGAL.upstreamAuthor).toBe('Wendale Franz Dy');
    expect(LEGAL.upstreamUrl).toBe('https://github.com/sheeshcake/Flickv4');
    expect(LEGAL.attributionLine).toMatch(/Wendale Franz Dy/);
    expect(LEGAL.attributionLine).toMatch(/GPL-3\.0/);
    expect(LEGAL.sampleCredit).toMatch(/Blender Foundation/);
  });

  it('keeps the deferred surfaces off (Live TV is now restored)', () => {
    expect(FEATURES).toEqual({ liveTv: true, watchParty: false, tvLayout: false, updateChecker: false });
  });
});

/**
 * A flag nobody reads is worse than no flag, because it reads as handled. These assert the
 * derived configuration — which is what every screen actually consults — so a change that
 * reintroduces an ungated entry point fails here.
 */
describe('feature flags gate the surfaces they name', () => {
  it('shows Live TV now that its flag is on and the playlist is configured', () => {
    expect(LIVE_TV_CONFIG.enabled).toBe(true);
  });

  it('hides the watch party even with a party server configured', () => {
    expect(WATCH_PARTY_CONFIG.enabled).toBe(false);
  });

  it('keeps the ten-foot shell off on this build', () => {
    expect(isTVLayout).toBe(false);
  });

  it('ships no repository for the updater, so it can never point at another project', () => {
    expect(UPDATE_CONFIG.enabled).toBe(false);
    // Nothing is baked in: the upstream Flick repository used to be the default, which
    // meant a StreamZ build with the flag flipped would hand its users somebody else's
    // APK. The owner has to name their own releases through the environment.
    expect(UPDATE_CONFIG.OWNER).toBe('');
    expect(UPDATE_CONFIG.REPO).toBe('');
    expect(updateRepoConfigured()).toBe(false);
    expect(updatesActive()).toBe(false);
  });

  it('honours a grace window that is bounded, never unlimited', () => {
    expect(UPDATE_CONFIG.OFFLINE_GRACE_MS).toBeGreaterThan(0);
    expect(UPDATE_CONFIG.OFFLINE_GRACE_MS).toBeLessThanOrEqual(168 * 3_600_000);
  });
});

describe('config defaults', () => {
  it('matches the values frozen in the spec', () => {
    expect(CONFIG_DEFAULTS).toEqual({
      offlineGraceMinutes: 1440,
      keyDurationDays: 30,
      maxInstallationRotations: 5,
      staleSessionMinutes: 10,
      minAppVersion: '0.0.0',
    });
  });

  it('models carry the spec field shapes', () => {
    const doc: UserDoc = {
      uid: 'u1', email: 'a@b.c', displayName: 'A', photoURL: null, status: 'active',
      subscriptionId: null, installationId: null, activatedAt: null, expiresAt: null,
      lastLoginAt: 1, lastActiveAt: 1, appVersion: '1.0.0', createdAt: 1,
      installationRotations: 0,
    };
    const access: AccessResult = { status: 'authorized', expiresAt: 2, serverTimeMs: 1 };
    expect(doc.status).toBe('active');
    expect(access.serverTimeMs).toBe(1);
  });
});

describe('installationId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates once, lowercased, and reads back the same value', async () => {
    const first = await getInstallationId();
    expect(first).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(INSTALLATION_KEY, first);

    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(first);
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    expect(await getInstallationId()).toBe(first);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });


  it('regenerates when SecureStore rejects instead of stranding the gate', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('SecureStoreUnavailableException'),
    );
    (randomUUID as jest.Mock).mockReturnValueOnce('99999999-8888-7777-6666-555555555555');
    expect(await getInstallationId()).toBe('99999999-8888-7777-6666-555555555555');
  });

  it('persists the replacement after a corrupt value', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('garbage');
    (randomUUID as jest.Mock).mockReturnValueOnce('44444444-4444-4444-4444-444444444444');
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    await getInstallationId();
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      INSTALLATION_KEY,
      '44444444-4444-4444-4444-444444444444',
    );
  });
});
