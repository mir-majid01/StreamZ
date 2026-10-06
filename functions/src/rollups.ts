import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db, ensureConfig, readConfig } from './admin';

const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/**
 * Aggregates are written here and never from a device, so the client cannot inflate its
 * own watch time by incrementing counters directly. Only the open -> finalized transition
 * rolls up, and this handler writes only to the rollup collections: writing back to
 * watchSessions would re-trigger it.
 */
export const onWatchSessionWritten = onDocumentWritten(
  'watchSessions/{sessionId}',
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || before?.state !== 'open' || after.state !== 'finalized') return;

    const clamped = Math.min(Number(after.watchDurationMs ?? 0), Number(after.durationMs ?? 0));
    if (!Number.isFinite(clamped) || clamped <= 0 || !after.uid) return;

    const daily = db().collection('userDailyStats').doc(`${after.uid}__${dayKey(Number(after.startedAt ?? Date.now()))}`);
    const content = db().collection('contentStats').doc(String(after.contentId));

    await Promise.all([
      daily.set(
        {
          uid: after.uid,
          totalWatchMs: FieldValue.increment(clamped),
          sessions: FieldValue.increment(1),
        },
        { merge: true },
      ),
      content.set(
        {
          contentId: after.contentId,
          contentTitle: after.contentTitle ?? null,
          totalWatchMs: FieldValue.increment(clamped),
          sessions: FieldValue.increment(1),
        },
        { merge: true },
      ),
    ]);
  },
);

/**
 * A client killed mid-playback, a crash or a battery death leaves an open session that
 * would otherwise never roll up and never stop counting as current.
 */
export const finalizeStaleSessions = onSchedule('every 5 minutes', async () => {
  await ensureConfig();
  const config = await readConfig();
  const cutoff = Date.now() - config.staleSessionMinutes * 60_000;

  const stale = await db()
    .collection('watchSessions')
    .where('state', '==', 'open')
    .where('updatedAt', '<', cutoff)
    .limit(200)
    .get();

  if (stale.empty) return;

  await Promise.all(
    stale.docs.map(async (snap) => {
      const data = snap.data();
      const position = Number(data.positionMs ?? 0);
      const duration = Number(data.durationMs ?? 0) || position;
      await snap.ref.set(
        {
          state: 'finalized',
          endedAt: data.updatedAt ?? Date.now(),
          watchDurationMs: Math.min(Number(data.watchDurationMs ?? position), duration),
          completionPercentage: duration ? Math.min(1, position / duration) : 0,
          completed: duration > 0 && position / duration >= 0.9,
        },
        { merge: true },
      );
    }),
  );
});
