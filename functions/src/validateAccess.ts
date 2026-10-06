import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  appVersionOf,
  audit,
  db,
  ensureConfig,
  readConfig,
  requireAuth,
  requireInstallationId,
  rotateInstallation,
  rotationCountSince,
  upsertUser,
} from './admin';

export type AccessStatus =
  | 'authorized'
  | 'needsKey'
  | 'expired'
  | 'revoked'
  | 'suspended'
  | 'disabled'
  | 'installationCeiling';

export interface AccessResponse {
  status: AccessStatus;
  expiresAt: number | null;
  serverTimeMs: number;
}

const ok = (serverTimeMs: number): AccessResponse => ({
  status: 'authorized',
  expiresAt: null,
  serverTimeMs,
});

/**
 * The only routine call the app makes. Every timestamp is produced here: the client's
 * clock appears nowhere, which is what makes a locally edited expiry meaningless.
 */
export const validateAccess = onCall(async (req: CallableRequest): Promise<AccessResponse> => {
  const uid = requireAuth(req.auth);
  const installationId = requireInstallationId(req.data);
  const now = Date.now();

  await ensureConfig();
  const config = await readConfig();

  const userRef = db().collection('users').doc(uid);
  const existing = await userRef.get();
  const user = existing.data() ??
    (await upsertUser({
      uid,
      email: (req.auth?.token?.email as string | undefined) ?? '',
      displayName: (req.auth?.token?.name as string | undefined) ?? null,
      photoURL: (req.auth?.token?.picture as string | undefined) ?? null,
      installationId,
      appVersion: appVersionOf(req.data),
      now,
    })
      .then(() => ({})));

  const doc = (await userRef.get()).data() ?? (user as Record<string, unknown>);
  const status = (doc.status as string | undefined) ?? 'active';
  if (status === 'suspended' || status === 'disabled') {
    return { status: status as AccessStatus, expiresAt: null, serverTimeMs: now };
  }

  const current = (doc.installationId as string | null) ?? null;
  if (current && current !== installationId) {
    const rotations = await rotationCountSince(uid, now - 30 * 86_400_000);
    if (rotations >= config.maxInstallationRotations30d) {
      await audit(uid, 'user', 'installation.refused', uid, { presented: installationId, rotations });
      return { status: 'installationCeiling', expiresAt: null, serverTimeMs: now };
    }
    await rotateInstallation(uid, current, installationId, now);
  }

  const subscriptionId = (doc.subscriptionId as string | null) ?? null;
  if (!subscriptionId) return { status: 'needsKey', expiresAt: null, serverTimeMs: now };

  const keyRef = db().collection('subscriptionKeys').doc(subscriptionId);
  const key = (await keyRef.get()).data();

  if (!key) {
    await userRef.set({ subscriptionId: null, expiresAt: null }, { merge: true });
    return { status: 'revoked', expiresAt: null, serverTimeMs: now };
  }
  if (key.status === 'REVOKED') return { status: 'revoked', expiresAt: null, serverTimeMs: now };
  if (key.status === 'EXPIRED' || now >= (key.expiresAt ?? 0)) {
    if (key.status !== 'EXPIRED') await keyRef.set({ status: 'EXPIRED' }, { merge: true });
    await userRef.set({ expiresAt: key.expiresAt ?? null }, { merge: true });
    return { status: 'expired', expiresAt: key.expiresAt ?? null, serverTimeMs: now };
  }
  if (key.uid !== uid) {
    // A key rebound under us server-side; never hand out access.
    return { status: 'revoked', expiresAt: null, serverTimeMs: now };
  }

  await keyRef.set({ lastValidatedAt: now }, { merge: true });
  await userRef.set({ lastActiveAt: now, expiresAt: key.expiresAt }, { merge: true });
  return { ...ok(now), expiresAt: key.expiresAt ?? null };
});
