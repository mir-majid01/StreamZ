import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { WriteBatch } from 'firebase-admin/firestore';
import { audit, authAdmin, db, ensureConfig, readConfig, requireRole } from './admin';
import { formatKey, hashKey, randomKeyBody } from './keys';

const ADMIN_ROLES = ['admin', 'manager'] as const;
const BATCH_CHUNK = 400;
const MAX_KEYS_PER_CALL = 500;

/**
 * Returns the plaintext exactly once. Only `keyHash` is stored, so a lost key cannot be
 * recovered later — the admin revokes and reissues. That is the deliberate cost of not
 * keeping a stealable key table.
 */
export const generateKeys = onCall(async (req: CallableRequest) => {
  const actor = requireRole(req.auth, ADMIN_ROLES);
  await ensureConfig();
  const config = await readConfig();

  const count = Math.min(Number(req.data?.count ?? 10) || 0, MAX_KEYS_PER_CALL);
  const durationDays = Number(req.data?.durationDays ?? config.keyDurationDays) || config.keyDurationDays;
  if (count < 1) throw new Error('count must be at least 1');

  const created: string[] = [];
  const batch = db().batch() as unknown as WriteBatch;
  const now = Date.now();

  for (let i = 0; i < count; i += 1) {
    const body = randomKeyBody();
    const ref = db().collection('subscriptionKeys').doc();
    batch.set(ref, {
      keyHash: hashKey(body),
      status: 'UNUSED',
      durationDays,
      createdAt: now,
      createdBy: actor,
      activatedAt: null,
      expiresAt: null,
      uid: null,
      installationId: null,
      lastValidatedAt: null,
    });
    created.push(formatKey(body));
    if (created.length % BATCH_CHUNK === 0) await batch.commit();
  }
  await batch.commit();
  await audit(actor, 'admin', 'keys.generated', 'subscriptionKeys', { count, durationDays });
  return { keys: created, durationDays };
});

export const revokeKey = onCall(async (req: CallableRequest) => {
  const actor = requireRole(req.auth, ADMIN_ROLES);
  const keyId = String(req.data?.keyId ?? '');
  if (!keyId) throw new Error('keyId is required');

  const keyRef = db().collection('subscriptionKeys').doc(keyId);
  const key = await keyRef.get();
  if (!key.exists) return { revoked: false, reason: 'not-found' };

  const uid = key.data()?.uid as string | null | undefined;
  await keyRef.set({ status: 'REVOKED' }, { merge: true });
  if (uid) {
    await db().collection('users').doc(uid).set(
      { subscriptionId: null, expiresAt: null, status: 'disabled' },
      { merge: true },
    );
  }
  await audit(actor, 'admin', 'key.revoked', keyId, { affectedUid: uid ?? null });
  return { revoked: true };
});

/** The only writer of roles anywhere in the system. A client can never set its own. */
export const setAdminRole = onCall(async (req: CallableRequest) => {
  const actor = requireRole(req.auth, ['admin']);
  const targetUid = String(req.data?.uid ?? '');
  const role = req.data?.role;
  if (!targetUid) throw new Error('uid is required');
  if (targetUid === actor) return { changed: false, reason: 'cannot-change-own-role' };

  const allowed = ['admin', 'manager', 'support', 'user'] as const;
  if (!allowed.includes(role)) throw new Error('unknown role');

  await authAdmin().setCustomUserClaims(targetUid, role === 'user' ? {} : { role });
  await audit(actor, 'admin', 'role.set', targetUid, { role });
  return { changed: true, role };
});
