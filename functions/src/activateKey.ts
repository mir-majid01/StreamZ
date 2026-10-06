import { onCall } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, ensureConfig, readConfig, requireAuth, requireInstallationId, audit } from './admin';
import { hashKey, normalizeKeyBody } from './keys';

export type ActivateCode =
  | 'ACTIVATED'
  | 'ALREADY_OWNED'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_BOUND'
  | 'CEILING';

export interface ActivateResponse {
  code: ActivateCode;
  expiresAt: number | null;
}

/**
 * Activation is one Firestore transaction over the key and the user document, which is
 * what makes two devices racing for the same unused key resolve to exactly one winner.
 * Nothing here trusts a client assertion about ownership or expiry.
 */
export const activateKey = onCall(async (req: CallableRequest): Promise<ActivateResponse> => {
  const uid = requireAuth(req.auth);
  const installationId = requireInstallationId(req.data);
  const body = normalizeKeyBody(req.data?.key);
  if (!body) return { code: 'NOT_FOUND', expiresAt: null };

  await ensureConfig();
  const config = await readConfig();
  const keyHash = hashKey(body);
  const userRef = db().collection('users').doc(uid);

  const result = await db().runTransaction(async (tx) => {
    const found = await tx.get(
      db().collection('subscriptionKeys').where('keyHash', '==', keyHash).limit(1),
    );
    if (found.empty) return { code: 'NOT_FOUND', expiresAt: null } as ActivateResponse;

    const keySnap = found.docs[0];
    const keyRef = keySnap.ref;
    const key = keySnap.data();
    const now = Date.now();

    if (key.status === 'REVOKED') return { code: 'REVOKED', expiresAt: null } as ActivateResponse;

    if (key.uid === uid && key.installationId === installationId) {
      // Idempotent: an app restart must not error out.
      return { code: 'ALREADY_OWNED', expiresAt: key.expiresAt ?? null } as ActivateResponse;
    }
    if (key.uid && key.uid !== uid) {
      return { code: 'ALREADY_BOUND', expiresAt: null } as ActivateResponse;
    }
    if (key.uid === uid && key.installationId !== installationId) {
      return { code: 'ALREADY_BOUND', expiresAt: null } as ActivateResponse;
    }
    if (key.status === 'EXPIRED' || (key.expiresAt !== null && now >= key.expiresAt)) {
      tx.update(keyRef, { status: 'EXPIRED' });
      return { code: 'EXPIRED', expiresAt: key.expiresAt ?? null } as ActivateResponse;
    }

    const expiresAt =
      key.status === 'ACTIVE' && key.expiresAt
        ? (key.expiresAt as number)
        : now + (key.durationDays ?? config.keyDurationDays) * 86_400_000;

    tx.update(keyRef, {
      status: 'ACTIVE',
      uid,
      installationId,
      activatedAt: now,
      expiresAt,
      lastValidatedAt: now,
    });
    tx.set(
      userRef,
      { subscriptionId: keyRef.id, installationId, activatedAt: now, expiresAt, status: 'active' },
      { merge: true },
    );
    tx.set(
      db().collection('devices').doc(`${uid}__${installationId}`),
      { uid, installationId, firstSeenAt: now, lastSeenAt: now, revokedAt: null },
      { merge: true },
    );
    return { code: 'ACTIVATED', expiresAt } as ActivateResponse;
  });

  // Audit lives outside the transaction so a rolled-back attempt leaves no phantom record.
  await audit(uid, 'user', `key.${result.code.toLowerCase()}`, uid, {
    installationId,
    expiresAt: result.expiresAt,
  });
  return result;
});
