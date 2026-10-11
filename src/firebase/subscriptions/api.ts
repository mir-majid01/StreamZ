import { doc, getDoc, getFirestore, runTransaction } from '@react-native-firebase/firestore';
import { getAuth } from '@react-native-firebase/auth';
import { modelName } from 'expo-device';
import { currentUserUid, ensureFirebase } from '@/src/firebase/init';
import { getInstallationId } from '@/src/firebase/installation/installationId';
import { normalizeKeyBody } from '@/src/firebase/subscriptions/keyFormat';
import { keyDocId } from '@/src/firebase/subscriptions/keyHash';
import { sha256Hex } from '@/src/firebase/subscriptions/digests';
import { getAppVersion } from '@/src/utils/appVersion';
import {
  CONFIG_DEFAULTS,
  DAY_MS,
  type AccessResult,
  type AccessStatus,
  type ActivateResult,
  type AppConfigDoc,
  type DeviceDoc,
} from '@/src/firebase/models';

/**
 * There is no Cloud Functions tier — the project is on the free Spark plan — so the client
 * talks to Firestore directly and security rules are the only authority. That is why these
 * two functions read narrowly (one user document; one transaction on one key document
 * addressed by hash) and why every invariant the abandoned `activateKey` callable enforced
 * in code now has a counterpart in firestore.rules.
 */

/** Thrown when Firestore could not be reached. The gate maps this onto offline grace. */
export class TransportError extends Error {
  readonly code = 'unavailable';
  constructor(message = 'transport') {
    super(message);
    this.name = 'TransportError';
  }
}

// A hung read would otherwise leave the gate on `bootstrapping` behind a blank splash.
// The code is deliberately `deadline-exceeded` so it classifies as transport.
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

/** Firestore's code strings arrive both bare and namespaced across SDK versions. */
function errorText(e: unknown): string {
  const err = e as { code?: string | number; message?: string };
  const code = typeof err?.code === 'string' ? err.code : '';
  return `${code} ${err?.message ?? ''}`.toLowerCase();
}

const isRefusal = (e: unknown): boolean => /permission.denied|unauthenticated/.test(errorText(e));

/**
 * Exported so a screen can tell "the rules refused this write" apart from "the network was
 * down". The two need different copy: a refusal will fail identically on the next attempt,
 * while a transport error is worth retrying.
 */
export const isRulesRefusal = isRefusal;

/**
 * `permission-denied` is a rules verdict and must surface as itself: folding it into the
 * transport bucket would hand offline grace to someone the rules just refused.
 */
export function isFirestoreTransportFailure(e: unknown): boolean {
  if (e instanceof TransportError) return true;
  if (isRefusal(e)) return false;
  return /unavailable|deadline.exceeded|network|resource.exhausted|internal|unimplemented|cancelled/.test(
    errorText(e),
  );
}

const verdict = (status: AccessStatus, expiresAt: number | null): AccessResult => ({
  status,
  expiresAt,
  // No server clock any more: the "server time" the gate compares against is this device's
  // own reading, which is exactly what the rules' expiry arithmetic is checked against too.
  serverTimeMs: Date.now(),
});

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const maybeNum = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const deviceDocId = (uid: string, installationId: string): string => `${uid}__${installationId}`;

const deviceRecord = (
  uid: string,
  installationId: string,
  activatedAt: number,
  rotatedAt: number | null,
): DeviceDoc => ({
  uid,
  installationId,
  deviceModel: modelName ?? 'Android device',
  appVersion: getAppVersion(),
  activatedAt,
  rotatedAt,
});

/**
 * The user's own document plus the key it points at. The key is read too because it is the
 * surface an admin's revoke/expire actually lands on — with nothing running on a schedule,
 * nothing copies that verdict onto the user document, and a revoked subscriber would
 * otherwise sit comfortably inside its offline grace forever.
 */
export async function validate(): Promise<AccessResult> {
  if (!ensureFirebase()) throw new TransportError('firebase-unconfigured');
  const uid = currentUserUid();
  // SessionProvider only calls this once an auth uid exists; a caller without one is a
  // bug, and 'error' is the one status that cannot be mistaken for a subscription state.
  if (!uid) return verdict('error', null);
  const db = getFirestore();

  try {
    const userSnap = await withTimeout(getDoc(doc(db, 'users', uid)), VALIDATE_TIMEOUT_MS);
    // Rules do not reveal whether a document exists, so "absent" covers both the account
    // that has never activated and a document this caller may not read. Both mean: no
    // subscription on this account.
    if (!userSnap.exists()) return verdict('needsKey', null);
    const user = asRecord(userSnap.data());
    const status = String(user.status ?? 'active');
    if (status === 'suspended') return verdict('suspended', null);
    if (status === 'disabled') return verdict('disabled', null);

    const subscriptionId = typeof user.subscriptionId === 'string' ? user.subscriptionId : null;
    const userExpiry = num(user.expiresAt, 0);
    if (!subscriptionId || userExpiry <= 0) return verdict('needsKey', null);

    const keySnap = await withTimeout(
      getDoc(doc(db, 'subscriptionKeys', subscriptionId)),
      VALIDATE_TIMEOUT_MS,
    );
    if (!keySnap.exists()) {
      // The account points at a key this device cannot see. Trust the lower of the two
      // available answers rather than granting access on a document that may be gone.
      return userExpiry > Date.now()
        ? verdict('authorized', userExpiry)
        : verdict('expired', userExpiry);
    }
    const key = asRecord(keySnap.data());
    const keyStatus = String(key.status ?? '').toUpperCase();
    if (keyStatus === 'REVOKED') return verdict('revoked', null);
    if (keyStatus === 'EXPIRED') return verdict('expired', null);

    const keyExpiry = num(key.expiresAt, 0);
    if (keyStatus !== 'ACTIVE' || keyExpiry <= 0) return verdict('needsKey', null);
    const effective = Math.min(userExpiry, keyExpiry);
    return effective > Date.now()
      ? verdict('authorized', effective)
      : verdict('expired', effective);
  } catch (e) {
    if (isFirestoreTransportFailure(e)) throw new TransportError('transport');
    throw e;
  }
}

export async function activate(rawKey: string): Promise<ActivateResult> {
  const body = normalizeKeyBody(rawKey);
  if (!body) return { code: 'NOT_FOUND', expiresAt: null };
  if (!ensureFirebase()) throw new TransportError('firebase-unconfigured');
  const uid = currentUserUid();
  if (!uid) return { code: 'UNAUTHENTICATED', expiresAt: null };
  const keyId = await keyDocId(body, sha256Hex);
  if (!keyId) return { code: 'NOT_FOUND', expiresAt: null };

  const installationId = await getInstallationId();
  const db = getFirestore();
  const profile = getAuth().currentUser;

  try {
    return await withTimeout(
      runTransaction<ActivateResult>(db, async (tx) => {
        const keyRef = doc(db, 'subscriptionKeys', keyId);
        const userRef = doc(db, 'users', uid);
        const keySnap = await tx.get(keyRef);
        if (!keySnap.exists()) return { code: 'NOT_FOUND', expiresAt: null };
        const key = asRecord(keySnap.data());

        const now = Date.now();
        const keyStatus = String(key.status ?? 'UNUSED').toUpperCase();
        const keyExpiry = maybeNum(key.expiresAt);
        if (keyStatus === 'REVOKED') return { code: 'REVOKED', expiresAt: null };
        if (keyStatus === 'EXPIRED' || (keyExpiry !== null && keyExpiry <= now)) {
          return { code: 'EXPIRED', expiresAt: null };
        }
        if (keyStatus === 'ACTIVE') {
          return key.uid === uid
            ? { code: 'ALREADY_OWNED', expiresAt: keyExpiry }
            : { code: 'ALREADY_BOUND', expiresAt: null };
        }

        // Read inside the transaction: the rotation ceiling must be decided against the
        // value this write is conditioned on, not a snapshot that may have moved.
        const userSnap = await tx.get(userRef);
        const existing = userSnap.exists() ? asRecord(userSnap.data()) : null;
        const boundTo = typeof existing?.installationId === 'string' ? existing.installationId : null;
        const rotating = boundTo !== null && boundTo !== installationId;
        const rotations = num(existing?.installationRotations, 0);
        const config = asRecord((await tx.get(doc(db, 'config', 'app'))).data());
        const maxRotations = num(config.maxInstallationRotations, CONFIG_DEFAULTS.maxInstallationRotations);
        if (rotating && rotations >= maxRotations) return { code: 'CEILING', expiresAt: null };

        const durationDays = Math.max(1, Math.floor(num(key.durationDays, CONFIG_DEFAULTS.keyDurationDays)));
        const expiresAt = now + durationDays * DAY_MS;

        // Merge, never replace: keyHash, durationDays, createdAt and createdBy are
        // admin-owned, and the rules refuse a write that drops them.
        tx.set(keyRef, {
          status: 'ACTIVE',
          uid,
          installationId,
          activatedAt: now,
          expiresAt,
          lastValidatedAt: now,
        }, { merge: true });

        const userFields = {
          uid,
          status: 'active',
          subscriptionId: keyId,
          installationId,
          activatedAt: now,
          expiresAt,
          lastLoginAt: now,
          lastActiveAt: now,
          appVersion: getAppVersion(),
          installationRotations: rotating ? rotations + 1 : rotations,
        };
        if (existing) {
          tx.update(userRef, userFields);
        } else {
          tx.set(userRef, {
            ...userFields,
            email: profile?.email ?? '',
            displayName: profile?.displayName ?? null,
            photoURL: profile?.photoURL ?? null,
            createdAt: now,
          });
        }

        if (rotating) {
          // Merge so a first rotation on an account predating the devices collection
          // upserts a valid record instead of failing the whole transaction.
          tx.set(
            doc(db, 'devices', deviceDocId(uid, boundTo!)),
            deviceRecord(uid, boundTo!, num(existing?.activatedAt, now), now),
            { merge: true },
          );
        }
        tx.set(
          doc(db, 'devices', deviceDocId(uid, installationId)),
          deviceRecord(uid, installationId, now, null),
          { merge: true },
        );
        return { code: 'ACTIVATED', expiresAt };
      }),
      ACTIVATE_TIMEOUT_MS,
    );
  } catch (e) {
    if (isFirestoreTransportFailure(e)) throw new TransportError('transport');
    throw e;
  }
}

/** Bounds the app will honour, independent of what the config document happens to say. */
const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = num(value, fallback);
  return n < min || n > max ? fallback : n;
};

/**
 * `config/app` is written by staff, so it is treated as untrusted input on the way into the
 * gate: an out-of-range grace period would either lock every offline user out or hand them
 * unlimited access. The rules bound admin writes; this bounds what a device will act on.
 */
export async function readConfig(): Promise<AppConfigDoc> {
  if (!ensureFirebase()) return CONFIG_DEFAULTS;
  try {
    const snap = await withTimeout(
      getDoc(doc(getFirestore(), 'config', 'app')),
      VALIDATE_TIMEOUT_MS,
    );
    if (!snap.exists()) return CONFIG_DEFAULTS;
    const raw = asRecord(snap.data());
    return {
      offlineGraceMinutes: clamp(raw.offlineGraceMinutes, 0, 10_080, CONFIG_DEFAULTS.offlineGraceMinutes),
      keyDurationDays: clamp(raw.keyDurationDays, 1, 3650, CONFIG_DEFAULTS.keyDurationDays),
      maxInstallationRotations: clamp(
        raw.maxInstallationRotations,
        0,
        100,
        CONFIG_DEFAULTS.maxInstallationRotations,
      ),
      staleSessionMinutes: clamp(raw.staleSessionMinutes, 1, 1440, CONFIG_DEFAULTS.staleSessionMinutes),
      minAppVersion: typeof raw.minAppVersion === 'string' ? raw.minAppVersion : CONFIG_DEFAULTS.minAppVersion,
    };
  } catch (e) {
    if (isFirestoreTransportFailure(e)) return CONFIG_DEFAULTS;
    throw e;
  }
}
