/**
 * Executable version of the security checklist: every refusal is an assertion.
 * These rules are the whole backend — there is no Cloud Functions tier on the Spark plan —
 * so this file is what stands between a sideloaded APK and the subscription ledger.
 * Runs against the Firestore emulator only:
 *   npx firebase-tools emulators:exec --only firestore "npx jest __tests__/rules --ci"
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  runTransaction,
  setDoc,
  updateDoc,
  type Transaction,
} from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'streamz-rules-test';
const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const ALICE_EMAIL = 'alice@example.com';

const DAY = 86_400_000;

// Key documents are addressed by the SHA-256 of their plaintext, so the ids here are
// 64-character hex strings and nothing else.
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SESSION = `${ALICE}__1700000000000`;

let env: RulesTestEnvironment;

const keyDoc = (over: Record<string, unknown> = {}) => ({
  keyHash: HASH_A,
  status: 'UNUSED',
  durationDays: 30,
  createdAt: Date.now() - DAY,
  createdBy: 'owner@example.com',
  ...over,
});

const activationFields = (
  uid: string,
  keyId: string,
  installationId: string,
  now = Date.now(),
  durationDays = 30,
) => ({
  uid,
  email: uid === ALICE ? ALICE_EMAIL : 'bob@example.com',
  displayName: null,
  photoURL: null,
  status: 'active',
  subscriptionId: keyId,
  installationId,
  activatedAt: now,
  expiresAt: now + durationDays * DAY,
  lastLoginAt: now,
  lastActiveAt: now,
  appVersion: '0.1.0',
  installationRotations: 0,
  createdAt: now,
});

const sessionDoc = (over: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  uid: ALICE,
  state: 'open',
  startedAt: 1_700_000_000_000,
  contentId: 'tmdb:603',
  contentTitle: 'Sintel',
  contentType: 'movie',
  positionMs: 0,
  durationMs: 60_000,
  watchDurationMs: 0,
  completionPercentage: 0,
  completed: false,
  installationId: 'inst-alice1',
  appVersion: '0.1.0',
  updatedAt: 1_700_000_000_000,
  endedAt: null,
  ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
    },
  });
});

afterEach(async () => {
  await env.clearFirestore();
});

const alice = () =>
  env.authenticatedContext(ALICE, { email: ALICE_EMAIL }).firestore();
const bob = () => env.authenticatedContext(BOB, { email: 'bob@example.com' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
// Roles are custom claims. Only the Firebase console (or the Admin SDK) can set them,
// which is precisely why a phone carrying one may be trusted to mint keys.
const staff = (role: string) =>
  env.authenticatedContext(`staff-${role}`, { role, email: `${role}@example.com` }).firestore();

/** Seeds with rules disabled, i.e. as an administrator with the console would. */
const seed = (collectionName: string, id: string, data: Record<string, unknown>) =>
  env.withSecurityRulesDisabled((admin) =>
    setDoc(doc(admin.firestore(), collectionName, id), data),
  );

// withSecurityRulesDisabled deliberately swallows the callback's return value, so a
// privileged read has to escape through a holder instead.
const readAsAdmin = async ( fullPath: string): Promise<Record<string, unknown>> => {
  let out: Record<string, unknown> = {};
  await env.withSecurityRulesDisabled(async (admin) => {
    const snap = await getDoc(doc(admin.firestore(), fullPath));
    out = (snap.data() ?? {}) as Record<string, unknown>;
  });
  return out;
};

describe('minting keys', () => {
  it('refuses every non-staff caller', async () => {
    for (const db of [alice(), bob(), staff('support'), anon()]) {
      await assertFails(setDoc(doc(db, 'subscriptionKeys', HASH_B), keyDoc({ keyHash: HASH_B })));
    }
  });

  it('lets a manager mint an unused key whose id is its own hash', async () => {
    await assertSucceeds(
      setDoc(doc(staff('manager'), 'subscriptionKeys', HASH_B), keyDoc({ keyHash: HASH_B })),
    );
  });

  it('refuses a document id that is not the stored hash', async () => {
    // The whole addressing scheme rests on this, so it is enforced rather than assumed.
    await assertFails(setDoc(doc(staff('admin'), 'subscriptionKeys', HASH_B), keyDoc()));
    await assertFails(
      setDoc(doc(staff('admin'), 'subscriptionKeys', 'key_not_a_hash'), keyDoc({ keyHash: 'key_not_a_hash' })),
    );
  });

  it('refuses a key minted already bound or already active', async () => {
    await assertFails(
      setDoc(doc(staff('admin'), 'subscriptionKeys', HASH_B), keyDoc({ keyHash: HASH_B, status: 'ACTIVE', uid: ALICE })),
    );
    await assertFails(
      setDoc(doc(staff('admin'), 'subscriptionKeys', HASH_B), keyDoc({ keyHash: HASH_B, durationDays: 0 })),
    );
  });
});

describe('reading keys', () => {
  beforeEach(async () => {
    await seed('subscriptionKeys', HASH_A, keyDoc());
  });

  it('lets any signed-in device read an unbound key, which is what makes activation possible', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'subscriptionKeys', HASH_A)));
    await assertSucceeds(getDoc(doc(bob(), 'subscriptionKeys', HASH_A)));
  });

  it('hides somebody else’s bound key', async () => {
    await seed('subscriptionKeys', HASH_A, keyDoc({ status: 'ACTIVE', uid: ALICE }));
    await assertFails(getDoc(doc(bob(), 'subscriptionKeys', HASH_A)));
    await assertSucceeds(getDoc(doc(alice(), 'subscriptionKeys', HASH_A)));
  });

  it('never lets a subscriber list the collection', async () => {
    // Rules cannot see query filters, so `list` here would hand every device the keyspace.
    await assertFails(getDocs(collection(alice(), 'subscriptionKeys')));
    await assertSucceeds(getDocs(collection(staff('manager'), 'subscriptionKeys')));
  });

  it('refuses an unauthenticated read', async () => {
    await assertFails(getDoc(doc(anon(), 'subscriptionKeys', HASH_A)));
  });
});

describe('activating a key', () => {
  beforeEach(async () => {
    await seed('config', 'app', {
      offlineGraceMinutes: 1440,
      keyDurationDays: 30,
      maxInstallationRotations: 2,
      staleSessionMinutes: 10,
      minAppVersion: '0.0.0',
    });
    await seed('subscriptionKeys', HASH_A, keyDoc());
  });

  /** The exact shape of the client transaction, so a rules change breaks here, not on a phone. */
  const activateIn = async (
    db: ReturnType<typeof alice>,
    uid: string,
    keyId: string,
    installationId: string,
    now = Date.now(),
  ) =>
    runTransaction(db, async (tx: Transaction) => {
      const key = await tx.get(doc(db, 'subscriptionKeys', keyId));
      const user = await tx.get(doc(db, 'users', uid));
      const durationDays = key.data()!.durationDays as number;
      tx.set(
        doc(db, 'subscriptionKeys', keyId),
        { status: 'ACTIVE', uid, installationId, activatedAt: now, expiresAt: now + durationDays * DAY },
        { merge: true },
      );
      const fields = activationFields(uid, keyId, installationId, now, durationDays);
      if (user.exists()) {
        tx.update(doc(db, 'users', uid), {
          uid: fields.uid,
          status: fields.status,
          subscriptionId: fields.subscriptionId,
          installationId: fields.installationId,
          activatedAt: fields.activatedAt,
          expiresAt: fields.expiresAt,
          lastLoginAt: fields.lastLoginAt,
          lastActiveAt: fields.lastActiveAt,
          appVersion: fields.appVersion,
          installationRotations: 0,
        });
      } else {
        tx.set(doc(db, 'users', uid), fields);
      }
      tx.set(
        doc(db, 'devices', `${uid}__${installationId}`),
        {
          uid,
          installationId,
          deviceModel: 'Pixel 7',
          appVersion: '0.1.0',
          activatedAt: now,
          rotatedAt: null,
        },
        { merge: true },
      );
    });

  it('binds an unused key and creates the subscriber’s own document', async () => {
    await activateIn(alice(), ALICE, HASH_A, 'inst-alice1');
    const key = await readAsAdmin(`subscriptionKeys/${HASH_A}`);
    expect(key.status).toBe('ACTIVE');
    expect(key.uid).toBe(ALICE);
    // The admin-owned fields survived a merge write.
    expect(key.createdBy).toBe('owner@example.com');
    const user = await readAsAdmin(`users/${ALICE}`);
    expect(user.subscriptionId).toBe(HASH_A);
  });

  it('activates onto a staff record that was made by hand in the console', async () => {
    // Staff accounts are seeded as a four-field record (createdAt/status/role/email) and
    // carry none of the subscriber fields. If the activation branch only accepts a document
    // that already looks like a subscriber, an admin's own phone cannot subscribe with a key
    // and the refusal arrives as an opaque "activation failed".
    await seed('users', ALICE, {
      createdAt: Date.now() - DAY,
      status: 'active',
      role: 'admin',
      email: ALICE_EMAIL,
    });

    await activateIn(alice(), ALICE, HASH_A, 'inst-alice1');

    const user = await readAsAdmin(`users/${ALICE}`);
    expect(user.subscriptionId).toBe(HASH_A);
    expect(user.installationId).toBe('inst-alice1');
    // Hand-made fields are not the caller's to overwrite, and the role stays where it was.
    expect(user.role).toBe('admin');
  });

  it('refuses a second activation of the same key by another account', async () => {
    await seed('subscriptionKeys', HASH_A, keyDoc({ status: 'ACTIVE', uid: ALICE }));
    await expect(activateIn(bob(), BOB, HASH_A, 'inst-bob02')).rejects.toThrow();
  });

  it('refuses more time than the key grants', async () => {
    await expect(
      runTransaction(alice(), async (tx: Transaction) => {
        const key = await tx.get(doc(alice(), 'subscriptionKeys', HASH_A));
        const now = Date.now();
        tx.set(
          doc(alice(), 'subscriptionKeys', HASH_A),
          {
            status: 'ACTIVE',
            uid: ALICE,
            installationId: 'inst-alice1',
            activatedAt: now,
            // One day beyond durationDays — the arithmetic the old callable performed.
            expiresAt: now + (key.data()!.durationDays as number + 1) * DAY,
          },
          { merge: true },
        );
      }),
    ).rejects.toThrow();
  });

  it('refuses an activation timestamp that is not this write', async () => {
    // request.time is the only clock a rules file can trust; without this bound a device
    // could back-date an activation and stretch a 30-day key across a decade.
    await expect(activateIn(alice(), ALICE, HASH_A, 'inst-alice1', Date.now() - 60 * DAY)).rejects.toThrow();
  });

  it('refuses a user document created under somebody else’s email', async () => {
    await expect(
      setDoc(doc(alice(), 'users', ALICE), {
        ...activationFields(ALICE, HASH_A, 'inst-alice1'),
        email: 'nobody@example.com',
      }),
    ).rejects.toThrow();
  });

  it('refuses a subscriptionId that points at a key not bound to the caller', async () => {
    await seed('users', ALICE, { uid: ALICE, email: ALICE_EMAIL, status: 'active', installationRotations: 0 });
    await assertFails(
      updateDoc(doc(alice(), 'users', ALICE), { subscriptionId: HASH_B, status: 'active' }),
    );
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { expiresAt: Date.now() + 999 * DAY }));
  });

  it('refuses a client that tries to grant itself a staff role', async () => {
    await seed('users', ALICE, { uid: ALICE, email: ALICE_EMAIL, status: 'active', installationRotations: 0 });
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { role: 'admin' }));
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { admin: true }));
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { uid: BOB }));
  });

  it('still allows the presence heartbeat alone', async () => {
    await seed('users', ALICE, { uid: ALICE, email: ALICE_EMAIL, status: 'active', installationRotations: 0 });
    await assertSucceeds(updateDoc(doc(alice(), 'users', ALICE), { lastActiveAt: Date.now() }));
  });
});

describe('installation rotation ceiling', () => {
  const bound = () => ({
    uid: ALICE,
    email: ALICE_EMAIL,
    status: 'active',
    subscriptionId: HASH_A,
    installationId: 'inst-alice1',
    activatedAt: Date.now(),
    expiresAt: Date.now() + 30 * DAY,
    lastActiveAt: Date.now(),
    appVersion: '0.1.0',
    installationRotations: 1,
  });

  beforeEach(async () => {
    await seed('config', 'app', {
      maxInstallationRotations: 2,
      keyDurationDays: 30,
      offlineGraceMinutes: 1440,
    });
    await seed('subscriptionKeys', HASH_A, keyDoc({ status: 'ACTIVE', uid: ALICE }));
    await seed('users', ALICE, bound());
  });

  it('allows a heartbeat that spends nothing', async () => {
    await assertSucceeds(updateDoc(doc(alice(), 'users', ALICE), { lastActiveAt: Date.now() + 1000 }));
  });

  it('refuses a counter that goes backwards or skips ahead', async () => {
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { installationRotations: 0 }));
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { installationRotations: 9 }));
  });

  it('refuses a new installation without spending a rotation', async () => {
    await assertFails(updateDoc(doc(alice(), 'users', ALICE), { installationId: 'brand-new-device' }));
  });

  it('refuses the rotation once the configured ceiling is spent', async () => {
    await assertFails(
      updateDoc(doc(alice(), 'users', ALICE), {
        installationId: 'brand-new-device',
        installationRotations: 2,
      }),
    );
  });

  it('allows one more rotation while the budget lasts', async () => {
    await seed('users', ALICE, { ...bound(), installationRotations: 0 });
    await seed('subscriptionKeys', HASH_B, keyDoc({
      keyHash: HASH_B,
      status: 'ACTIVE',
      uid: ALICE,
      expiresAt: Date.now() + 30 * DAY,
    }));
    await assertSucceeds(
      updateDoc(doc(alice(), 'users', ALICE), {
        installationId: 'brand-new-device',
        subscriptionId: HASH_B,
        installationRotations: 1,
      }),
    );
  });

  it('lets staff reset the binding, which is the support path around the ceiling', async () => {
    await assertSucceeds(updateDoc(doc(staff('manager'), 'users', ALICE), { installationId: 'reset' }));
    await assertSucceeds(updateDoc(doc(staff('admin'), 'users', ALICE), { status: 'suspended' }));
  });

  it('refuses a support-role write of anything at all', async () => {
    await assertFails(updateDoc(doc(staff('support'), 'users', ALICE), { status: 'disabled' }));
    await assertFails(updateDoc(doc(staff('support'), 'users', ALICE), { installationId: 'reset' }));
  });
});

describe('devices', () => {
  beforeEach(async () => {
    await seed('devices', `${ALICE}__inst-alice1`, {
      uid: ALICE,
      installationId: 'inst-alice1',
      deviceModel: 'Pixel 7',
      appVersion: '0.1.0',
      activatedAt: Date.now() - DAY,
      rotatedAt: null,
    });
  });

  it('lets the owner read their own history and nobody else’s', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'devices', `${ALICE}__inst-alice1`)));
    await assertFails(getDoc(doc(bob(), 'devices', `${ALICE}__inst-alice1`)));
    await assertSucceeds(getDoc(doc(staff('support'), 'devices', `${ALICE}__inst-alice1`)));
  });

  it('lets an owner mark a previous installation rotated and nothing more', async () => {
    await assertSucceeds(updateDoc(doc(alice(), 'devices', `${ALICE}__inst-alice1`), { rotatedAt: Date.now() }));
    await assertFails(updateDoc(doc(alice(), 'devices', `${ALICE}__inst-alice1`), { deviceModel: 'Fake Pro' }));
    await assertFails(deleteDoc(doc(alice(), 'devices', `${ALICE}__inst-alice1`)));
  });

  it('refuses a device record written under another uid', async () => {
    await assertFails(
      setDoc(doc(alice(), 'devices', `${BOB}__inst-9`), {
        uid: BOB,
        installationId: 'inst-other9',
        deviceModel: 'Pixel 7',
        appVersion: '0.1.0',
        activatedAt: Date.now(),
        rotatedAt: null,
      }),
    );
  });
});

describe('daily rollups', () => {
  it('lets a subscriber record their own day, bounded', async () => {
    await assertSucceeds(
      setDoc(doc(alice(), 'userDailyStats', `${ALICE}__19800`), {
        uid: ALICE,
        dateEpochDay: 19800,
        watchMs: 45 * 60_000,
        sessions: 1,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), 'userDailyStats', `${ALICE}__19800`), { watchMs: 90 * 60_000, sessions: 2 }),
    );
  });

  it('refuses a day that watched more than it has been awake', async () => {
    await seed('userDailyStats', `${ALICE}__19800`, {
      uid: ALICE,
      dateEpochDay: 19800,
      watchMs: 1000,
      sessions: 1,
    });
    await assertFails(updateDoc(doc(alice(), 'userDailyStats', `${ALICE}__19800`), { watchMs: 9 * DAY }));
    await assertFails(updateDoc(doc(alice(), 'userDailyStats', `${ALICE}__19800`), { watchMs: 500 }));
  });

  it('refuses to write somebody else’s totals', async () => {
    await assertFails(
      setDoc(doc(bob(), 'userDailyStats', `${ALICE}__19800`), {
        uid: ALICE,
        dateEpochDay: 19800,
        watchMs: 1000,
        sessions: 1,
      }),
    );
  });

  it('keeps content rollups out of every client’s hands', async () => {
    await seed('contentStats', 'tmdb:603', { totalWatchMs: 10 });
    await assertSucceeds(getDoc(doc(staff('manager'), 'contentStats', 'tmdb:603')));
    await assertFails(getDoc(doc(alice(), 'contentStats', 'tmdb:603')));
    await assertFails(setDoc(doc(alice(), 'contentStats', 'tmdb:603'), { totalWatchMs: 9e15 }));
    await assertFails(setDoc(doc(staff('admin'), 'contentStats', 'tmdb:603'), { totalWatchMs: 9e15 }));
  });
});

describe('staff operations, config and audit', () => {
  beforeEach(async () => {
    await seed('config', 'app', {
      offlineGraceMinutes: 1440,
      keyDurationDays: 30,
      maxInstallationRotations: 2,
      staleSessionMinutes: 10,
      minAppVersion: '0.1.0',
    });
    await seed('subscriptionKeys', HASH_A, keyDoc({ status: 'ACTIVE', uid: ALICE, expiresAt: Date.now() + 30 * DAY }));
  });

  it('lets staff revoke and expire, but not rewrite the terms of a key', async () => {
    await assertSucceeds(updateDoc(doc(staff('manager'), 'subscriptionKeys', HASH_A), { status: 'REVOKED' }));
    await assertSucceeds(updateDoc(doc(staff('admin'), 'subscriptionKeys', HASH_A), { status: 'EXPIRED' }));
    await assertFails(updateDoc(doc(staff('admin'), 'subscriptionKeys', HASH_A), { durationDays: 3650 }));
    await assertFails(updateDoc(doc(staff('admin'), 'subscriptionKeys', HASH_A), { keyHash: HASH_B }));
    await assertFails(updateDoc(doc(staff('admin'), 'subscriptionKeys', HASH_A), { status: 'NOT_A_STATUS' }));
    await assertFails(deleteDoc(doc(staff('admin'), 'subscriptionKeys', HASH_A)));
  });

  it('refuses a subscriber touching a key they are not activating', async () => {
    await assertFails(updateDoc(doc(alice(), 'subscriptionKeys', HASH_A), { status: 'UNUSED' }));
    await assertFails(updateDoc(doc(alice(), 'subscriptionKeys', HASH_A), { expiresAt: Date.now() + 999 * DAY }));
  });

  it('reserves config for admins and keeps it readable for subscribers', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'config', 'app')));
    await assertSucceeds(
      updateDoc(doc(staff('admin'), 'config', 'app'), { offlineGraceMinutes: 60, keyDurationDays: 30, maxInstallationRotations: 2 }),
    );
    await assertFails(updateDoc(doc(staff('manager'), 'config', 'app'), { offlineGraceMinutes: 1 }));
    await assertFails(updateDoc(doc(alice(), 'config', 'app'), { offlineGraceMinutes: 99999 }));
    await assertFails(
      updateDoc(doc(staff('admin'), 'config', 'app'), { offlineGraceMinutes: 999999, keyDurationDays: 30, maxInstallationRotations: 2 }),
    );
  });

  it('accepts staff audit entries and refuses forged or edited ones', async () => {
    await assertSucceeds(
      setDoc(doc(staff('admin'), 'adminAudit', 'audit-1'), {
        actor: 'admin@example.com',
        action: 'key.revoke',
        targetType: 'key',
        targetId: HASH_A,
        timestamp: Date.now(),
      }),
    );
    await assertFails(
      setDoc(doc(staff('manager'), 'adminAudit', 'audit-2'), {
        actor: 'somebody-else@example.com',
        action: 'key.revoke',
        targetType: 'key',
        targetId: HASH_A,
        timestamp: Date.now(),
      }),
    );
    await assertFails(setDoc(doc(alice(), 'adminAudit', 'audit-3'), { action: 'forged' }));
  });

  it('refuses an unauthenticated staff read', async () => {
    await assertFails(getDocs(collection(anon(), 'users')));
    await assertFails(getDocs(collection(anon(), 'adminAudit')));
  });
});

describe('watch sessions', () => {
  it('accepts an open session owned by the caller', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'watchSessions', SESSION), sessionDoc()));
  });

  it('refuses a session attributed to someone else', async () => {
    await assertFails(
      setDoc(doc(alice(), 'watchSessions', `${BOB}__1`), sessionDoc({ uid: BOB, sessionId: `${BOB}__1` })),
    );
    await assertFails(setDoc(doc(bob(), 'watchSessions', SESSION), sessionDoc({ uid: BOB })));
  });

  it('refuses a document created already finalized, or with a mismatched id', async () => {
    await assertFails(setDoc(doc(alice(), 'watchSessions', SESSION), sessionDoc({ state: 'finalized' })));
    await assertFails(setDoc(doc(alice(), 'watchSessions', 'other-id'), sessionDoc({ sessionId: 'mismatch' })));
  });

  it('refuses an impossible watch duration', async () => {
    await assertFails(setDoc(doc(alice(), 'watchSessions', SESSION), sessionDoc({ watchDurationMs: 9_999_999 })));
  });

  it('allows progress and the one-way finalize transition', async () => {
    await seed('watchSessions', SESSION, sessionDoc());
    await assertSucceeds(
      updateDoc(doc(alice(), 'watchSessions', SESSION), { watchDurationMs: 5_000, positionMs: 5_000, updatedAt: 2 }),
    );
    await assertSucceeds(
      updateDoc(doc(alice(), 'watchSessions', SESSION), { state: 'finalized', endedAt: 3, completed: true }),
    );
  });

  it('makes a finalized session immutable, including against re-opening', async () => {
    await seed('watchSessions', SESSION, sessionDoc({ state: 'finalized', watchDurationMs: 30_000 }));
    await assertFails(updateDoc(doc(alice(), 'watchSessions', SESSION), { watchDurationMs: 1 }));
    await assertFails(updateDoc(doc(alice(), 'watchSessions', SESSION), { state: 'open' }));
    await assertFails(updateDoc(doc(alice(), 'watchSessions', SESSION), { completed: false }));
    await assertFails(deleteDoc(doc(alice(), 'watchSessions', SESSION)));
  });

  it('isolates sessions between users and opens them to staff', async () => {
    await seed('watchSessions', SESSION, sessionDoc());
    await assertFails(getDoc(doc(bob(), 'watchSessions', SESSION)));
    await assertFails(updateDoc(doc(bob(), 'watchSessions', SESSION), { watchDurationMs: 10 }));
    await assertSucceeds(getDoc(doc(staff('support'), 'watchSessions', SESSION)));
  });
});

describe('collections outside the schema', () => {
  it('are unreachable from every client', async () => {
    await seed('serviceAccounts', 'sa-1', { note: 'should be unreachable' });
    await assertFails(getDoc(doc(alice(), 'serviceAccounts', 'sa-1')));
    await assertFails(setDoc(doc(alice(), 'serviceAccounts', 'sa-2'), { note: 'nope' }));
    await assertFails(setDoc(doc(anon(), 'users', BOB), { uid: BOB }));
  });
});
