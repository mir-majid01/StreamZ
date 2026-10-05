/**
 * Executable version of the brief's security checklist: every refusal is an assertion.
 * Runs against the Firestore emulator only:
 *   npx firebase-tools emulators:exec --only firestore "npx jest __tests__/rules --ci"
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = 'streamz-rules-test';
const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const SESSION = `${ALICE}__1700000000000`;

let env: RulesTestEnvironment;

const sessionDoc = (over: Record<string, unknown> = {}) => ({
  sessionId: SESSION,
  uid: ALICE,
  state: 'open',
  startedAt: 1_700_000_000_000,
  contentId: 'tmdb:603',
  contentTitle: 'Sintel',
  contentType: 'clip',
  positionMs: 0,
  durationMs: 60_000,
  watchDurationMs: 0,
  completionPercentage: 0,
  completed: false,
  installationId: 'inst-1',
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

const alice = () => env.authenticatedContext(ALICE).firestore();
const bob = () => env.authenticatedContext(BOB).firestore();

/** Seeds with rules disabled, i.e. as the Admin SDK in Functions would. */
const seed = (collection: string, id: string, data: Record<string, unknown>) =>
  env.withSecurityRulesDisabled((admin) =>
    setDoc(doc(admin.firestore(), collection, id), data),
  );

describe('users', () => {
  beforeEach(async () => {
    await seed('users', ALICE, { uid: ALICE, email: 'a@b.c', status: 'active' });
  });

  it('lets a user read only their own document', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'users', ALICE)));
    await assertFails(getDoc(doc(bob(), 'users', ALICE)));
  });

  it('refuses every field a client could use to grant itself access', async () => {
    for (const patch of [
      { status: 'disabled' },
      { expiresAt: 8_000_000_000_000 },
      { subscriptionId: 'key-1' },
      { installationId: 'someone-elses-device' },
      { role: 'admin' },
      { admin: true },
      { uid: BOB },
    ]) {
      await assertFails(updateDoc(doc(alice(), 'users', ALICE), patch));
    }
  });

  it('allows the lastActiveAt heartbeat and nothing else', async () => {
    await assertSucceeds(updateDoc(doc(alice(), 'users', ALICE), { lastActiveAt: 5 }));
    await assertFails(
      updateDoc(doc(alice(), 'users', ALICE), { lastActiveAt: 5, status: 'disabled' }),
    );
  });

  it('cannot be created or deleted from a device', async () => {
    await assertFails(setDoc(doc(bob(), 'users', BOB), { uid: BOB, status: 'active' }));
    await assertFails(deleteDoc(doc(alice(), 'users', ALICE)));
  });
});

describe('subscription keys, rollups and audit are invisible to clients', () => {
  beforeEach(async () => {
    await seed('subscriptionKeys', 'key-1', { keyHash: 'abc', status: 'UNUSED' });
    await seed('contentStats', 'tmdb:603', { totalWatchMs: 10 });
    await seed('adminAudit', 'audit-1', { action: 'key.generated' });
    await seed('userDailyStats', `${ALICE}__20261003`, { sessions: 1 });
  });

  it('refuses reads and writes on all four collections', async () => {
    await assertFails(getDoc(doc(alice(), 'subscriptionKeys', 'key-1')));
    await assertFails(setDoc(doc(alice(), 'subscriptionKeys', 'key-2'), { keyHash: 'x' }));
    await assertFails(setDoc(doc(alice(), 'contentStats', 'tmdb:603'), { totalWatchMs: 9e15 }));
    await assertFails(setDoc(doc(alice(), 'adminAudit', 'a2'), { action: 'forged' }));
    await assertFails(setDoc(doc(alice(), 'userDailyStats', 'x__1'), { sessions: 99 }));
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
    await assertFails(
      setDoc(doc(bob(), 'watchSessions', SESSION), sessionDoc({ uid: BOB })),
    );
  });

  it('refuses a document created already finalized, or with a mismatched id', async () => {
    await assertFails(setDoc(doc(alice(), 'watchSessions', SESSION), sessionDoc({ state: 'finalized' })));
    await assertFails(setDoc(doc(alice(), 'watchSessions', 'other-id'), sessionDoc({ sessionId: 'mismatch' })));
  });

  it('refuses an impossible watch duration', async () => {
    await assertFails(
      setDoc(doc(alice(), 'watchSessions', SESSION), sessionDoc({ watchDurationMs: 9_999_999 })),
    );
  });

  it('allows progress and the one-way finalize transition', async () => {
    await seed('watchSessions', SESSION, sessionDoc());
    await assertSucceeds(updateDoc(doc(alice(), 'watchSessions', SESSION), { watchDurationMs: 5_000, positionMs: 5_000, updatedAt: 2 }));
    await assertSucceeds(updateDoc(doc(alice(), 'watchSessions', SESSION), { state: 'finalized', endedAt: 3, completed: true }));
  });

  it('makes a finalized session immutable, including against re-opening', async () => {
    await seed('watchSessions', SESSION, sessionDoc({ state: 'finalized', watchDurationMs: 30_000 }));
    await assertFails(updateDoc(doc(alice(), 'watchSessions', SESSION), { watchDurationMs: 1 }));
    await assertFails(updateDoc(doc(alice(), 'watchSessions', SESSION), { state: 'open' }));
    await assertFails(updateDoc(doc(alice(), 'watchSessions', SESSION), { completed: false }));
    await assertFails(deleteDoc(doc(alice(), 'watchSessions', SESSION)));
  });

  it('isolates sessions between users', async () => {
    await seed('watchSessions', SESSION, sessionDoc());
    await assertFails(getDoc(doc(bob(), 'watchSessions', SESSION)));
    await assertFails(updateDoc(doc(bob(), 'watchSessions', SESSION), { watchDurationMs: 10 }));
  });
});

describe('config and devices', () => {
  it('allows any signed-in user to read config but never write it', async () => {
    await seed('config', 'app', { offlineGraceMinutes: 1440 });
    await assertSucceeds(getDoc(doc(alice(), 'config', 'app')));
    await assertFails(updateDoc(doc(alice(), 'config', 'app'), { offlineGraceMinutes: 999_999 }));
  });

  it('refuses an unauthenticated config read', async () => {
    await seed('config', 'app', { offlineGraceMinutes: 1440 });
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'config', 'app')));
  });

  it('lets an owner read their device record and never edit it', async () => {
    await seed('devices', `${ALICE}__inst-1`, { uid: ALICE, installationId: 'inst-1', rotations: 0 });
    await assertSucceeds(getDoc(doc(alice(), 'devices', `${ALICE}__inst-1`)));
    await assertFails(updateDoc(doc(alice(), 'devices', `${ALICE}__inst-1`), { rotations: 0 }));
  });

  it('refuses an unrelated device read', async () => {
    await seed('devices', `${ALICE}__inst-1`, { uid: ALICE, installationId: 'inst-1', rotations: 0 });
    await assertFails(getDoc(doc(bob(), 'devices', `${ALICE}__inst-1`)));
  });
});
