import functions from '@react-native-firebase/functions';
import { ensureFirebase } from '@/src/firebase/init';
import { getInstallationId } from '@/src/firebase/installation/installationId';
import { normalizeKeyBody } from '@/src/firebase/subscriptions/keyFormat';
import type { AccessResult, ActivateResult } from '@/src/firebase/models';
import { getAppVersion } from '@/src/utils/appVersion';

/** Thrown when the server could not be reached. The gate maps this onto offline grace. */
export class TransportError extends Error {
  readonly code = 'unavailable';
  constructor(message = 'transport') {
    super(message);
    this.name = 'TransportError';
  }
}

// A hung callable would otherwise leave the gate on `bootstrapping` and the user on a
// blank splash. The code is deliberately `deadline-exceeded` so it classifies as
// transport and grace can apply.
const VALIDATE_TIMEOUT_MS = 10_000;
const ACTIVATE_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TransportError('deadline-exceeded')), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function validate(): Promise<AccessResult> {
  if (!ensureFirebase()) throw new TransportError('firebase-unconfigured');
  const installationId = await getInstallationId();
  try {
    const res = await withTimeout(
      functions().httpsCallable('validateAccess')({ installationId, appVersion: getAppVersion() }),
      VALIDATE_TIMEOUT_MS,
    );
    const data = res.data as AccessResult;
    if (!data || typeof data.status !== 'string' || typeof data.serverTimeMs !== 'number') {
      throw new TransportError('malformed-verdict');
    }
    return data;
  } catch (e) {
    if (isCallableTransportFailure(e)) throw new TransportError('transport');
    throw e;
  }
}

export async function activate(rawKey: string): Promise<ActivateResult> {
  const body = normalizeKeyBody(rawKey);
  if (!body) return { code: 'NOT_FOUND', expiresAt: null };
  const installationId = await getInstallationId();
  try {
    const res = await withTimeout(
      functions().httpsCallable('activateKey')({ key: body, installationId }),
      ACTIVATE_TIMEOUT_MS,
    );
    return res.data as ActivateResult;
  } catch (e) {
    if (isCallableTransportFailure(e)) throw new TransportError('transport');
    throw e;
  }
}

function isCallableTransportFailure(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? '';
  return /(^|\/)unavailable$|deadline-exceeded|internal|network-request-failed/.test(code);
}
