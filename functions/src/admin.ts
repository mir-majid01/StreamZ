import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError } from 'firebase-functions/v2/https';

export const adminApp = () => (getApps().length ? getApps()[0] : initializeApp());
export const db = () => getFirestore(adminApp());
export const authAdmin = () => getAuth(adminApp());

export const CONFIG_DOC = 'config/app';
export const ROTATION_WINDOW_MS = 30 * 86_400_000;

export interface AppConfig {
  offlineGraceMinutes: number;
  keyDurationDays: number;
  maxInstallationRotations30d: number;
  staleSessionMinutes: number;
  minAppVersion: string;
}

export const CONFIG_DEFAULTS: AppConfig = {
  offlineGraceMinutes: 1440,
  keyDurationDays: 30,
  maxInstallationRotations30d: 3,
  staleSessionMinutes: 10,
  minAppVersion: '0.0.0',
};

export async function ensureConfig(): Promise<void> {
  const ref = db().doc(CONFIG_DOC);
  if ((await ref.get()).exists) return;
  await ref.set(CONFIG_DEFAULTS);
}

export async function readConfig(): Promise<AppConfig> {
  const snap = await db().doc(CONFIG_DOC).get();
  return { ...CONFIG_DEFAULTS, ...(snap.data() ?? {}) } as AppConfig;
}

export function requireAuth(auth: unknown): string {
  const uid = (auth as { uid?: string } | undefined)?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return uid;
}

/** Roles live in custom claims and are only ever written by setAdminRole below. */
export function requireRole(auth: unknown, roles: readonly string[]): string {
  const uid = requireAuth(auth);
  const role = (auth as { token?: { role?: string } }).token?.role;
  if (!role || !roles.includes(role)) {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }
  return uid;
}

export function requireInstallationId(data: DocumentData | undefined): string {
  const value = data?.installationId;
  if (typeof value !== 'string' || value.length < 8 || value.length > 64) {
    throw new HttpsError('invalid-argument', 'A valid installation id is required.');
  }
  return value;
}

export const appVersionOf = (data: DocumentData | undefined): string =>
  typeof data?.appVersion === 'string' ? data.appVersion : '0.0.0';

export async function audit(
  actorUid: string,
  actorRole: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const at = Date.now();
  await db()
    .collection('adminAudit')
    .add({ actorUid, actorRole, action, targetId, metadata, at });
}

export interface UpsertUserInput {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  installationId: string;
  appVersion: string;
  now: number;
}

/** Creates the user document on first call; the client never has create permission. */
export async function upsertUser(input: UpsertUserInput): Promise<DocumentData> {
  const ref = db().collection('users').doc(input.uid);
  const existing = await ref.get();

  if (!existing.exists) {
    await ref.set({
      uid: input.uid,
      email: input.email,
      displayName: input.displayName,
      photoURL: input.photoURL,
      status: 'active',
      subscriptionId: null,
      installationId: input.installationId,
      activatedAt: null,
      expiresAt: null,
      lastLoginAt: input.now,
      lastActiveAt: input.now,
      appVersion: input.appVersion,
      createdAt: input.now,
    });
    await db().collection('devices').doc(`${input.uid}__${input.installationId}`).set({
      uid: input.uid,
      installationId: input.installationId,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      rotations: 0,
      revokedAt: null,
    });
    return existing.data ?? {};
  }

  await ref.set({ lastLoginAt: input.now, lastActiveAt: input.now, email: input.email }, { merge: true });
  return existing.data() ?? {};
}

export async function rotationCountSince(uid: string, sinceMs: number): Promise<number> {
  const snap = await db()
    .collection('devices')
    .where('uid', '==', uid)
    .where('rotatedAt', '>=', sinceMs)
    .get();
  return snap.size;
}

/** Records the rotation on the device document and the user row, then audits it. */
export async function rotateInstallation(
  uid: string,
  from: string | null,
  to: string,
  now: number,
): Promise<void> {
  const batch = db().batch();
  if (from) {
    batch.set(
      db().collection('devices').doc(`${uid}__${from}`),
      { revokedAt: now, lastSeenAt: now },
      { merge: true },
    );
  }
  batch.set(
    db().collection('devices').doc(`${uid}__${to}`),
    {
      uid,
      installationId: to,
      firstSeenAt: now,
      lastSeenAt: now,
      rotatedAt: now,
      revokedAt: null,
      rotations: FieldValue.increment(1),
    },
    { merge: true },
  );
  batch.set(db().collection('users').doc(uid), { installationId: to }, { merge: true });
  await batch.commit();
  await audit(uid, 'user', 'installation.rotated', uid, { from, to });
}

export async function setRole(uid: string, role: string | null): Promise<void> {
  await authAdmin().setCustomUserClaims(uid, role ? { role } : {});
}
