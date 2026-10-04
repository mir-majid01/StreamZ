jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: jest.fn(() => ({})),
  httpsCallable: jest.fn(),
}));
jest.mock('@/src/firebase/init', () => ({
  ensureFirebase: jest.fn(() => true),
  functions: jest.fn(() => ({})),
}));
jest.mock('@/src/firebase/installation/installationId', () => ({
  getInstallationId: jest.fn(async () => 'inst-1'),
}));
jest.mock('@/src/utils/appVersion', () => ({ getAppVersion: () => '1.0.0' }));

import { httpsCallable } from '@react-native-firebase/functions';
import { ensureFirebase } from '@/src/firebase/init';
import { validate, activate, TransportError } from '@/src/firebase/subscriptions/api';

const callable = httpsCallable as unknown as jest.Mock;

beforeEach(() => {
  callable.mockReset();
  (ensureFirebase as jest.Mock).mockReturnValue(true);
});

describe('validate', () => {
  it('sends the installation id and app version the server needs', async () => {
    callable.mockImplementation(() => async () => ({
      data: { status: 'needsKey', expiresAt: null, serverTimeMs: 5 },
    }));
    const r = await validate();
    expect(callable.mock.calls[0][1]).toBe('validateAccess');
    expect(r.status).toBe('needsKey');
  });

  it('treats a malformed verdict as transport rather than trusting it', async () => {
    callable.mockImplementation(() => async () => ({ data: { status: 'authorized' } }));
    await expect(validate()).rejects.toBeInstanceOf(TransportError);
  });

  it('surfaces permission-denied as an authorization failure, not a transport one', async () => {
    callable.mockImplementation(() => async () => {
      throw Object.assign(new Error('nope'), { code: 'permission-denied' });
    });
    await expect(validate()).rejects.not.toBeInstanceOf(TransportError);
  });

  it('maps unavailable to TransportError so grace can apply', async () => {
    callable.mockImplementation(() => async () => {
      throw Object.assign(new Error('down'), { code: 'functions/unavailable' });
    });
    await expect(validate()).rejects.toBeInstanceOf(TransportError);
  });

  it('fails as transport when native config is missing', async () => {
    (ensureFirebase as jest.Mock).mockReturnValue(false);
    await expect(validate()).rejects.toBeInstanceOf(TransportError);
  });
});

describe('activate', () => {
  it('never sends a key the client can already see is malformed', async () => {
    const r = await activate('not-a-key');
    expect(r.code).toBe('NOT_FOUND');
    expect(callable).not.toHaveBeenCalled();
  });

  it('sends the normalized body, not the decorated display value', async () => {
    callable.mockImplementation(() => async (payload: Record<string, unknown>) => {
      expect(payload).toEqual({ key: '7H3K92PQX8KM', installationId: 'inst-1' });
      return { data: { code: 'ACTIVATED', expiresAt: 99 } };
    });
    const r = await activate('flk-7h3k-92pq-x8km');
    expect(r.code).toBe('ACTIVATED');
  });

  it('keeps ALREADY_BOUND distinguishable from a network failure', async () => {
    callable.mockImplementation(() => async () => ({
      data: { code: 'ALREADY_BOUND', expiresAt: null },
    }));
    const r = await activate('FLK-7H3K-92PQ-X8KM');
    expect(r.code).toBe('ALREADY_BOUND');
  });
});
