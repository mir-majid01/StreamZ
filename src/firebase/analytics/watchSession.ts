import { doc, getDoc, setDoc, updateDoc, getFirestore } from '@react-native-firebase/firestore';
import { currentUserUid } from '@/src/firebase/init';
import { getInstallationId } from '@/src/firebase/installation/installationId';
import { getAppVersion } from '@/src/utils/appVersion';
import type { ContentIdentity, WatchSessionDoc } from '@/src/firebase/models';

/**
 * Watch-time analytics, written by the device that watched. There is no server to compute
 * it on the Spark plan, so firestore.rules is what keeps a client from inventing a day of
 * infinite viewing: a session only grows monotonically, can never claim more watched time
 * than the title runs for, and becomes immutable once finalized.
 *
 * Nothing here may disturb playback. Every Firestore failure is swallowed — a lost
 * statistic is not a user-visible error, and a raw SDK error never reaches the screen.
 */

// A jump in position is a seek or an auto-play, not attention. Counting it would let one
// skip manufacture an hour of watch time.
const MAX_TICK_MS = 10_000;
// Positions arrive about once a second; writing each one would spend the subscriber's data
// plan and the Firestore write budget for no analytical gain.
const FLUSH_INTERVAL_MS = 30_000;
const DAY_MS = 86_400_000;

export const clampDelta = (positionMs: number, lastPositionMs: number | null): number => {
  if (lastPositionMs === null) return 0;
  const delta = positionMs - lastPositionMs;
  return delta <= 0 ? 0 : Math.min(delta, MAX_TICK_MS);
};

/**
 * Two different numbers, and the admin needs both: how far through the title the viewer
 * got (completion) and how long they actually spent (watch time, which excludes seeking
 * past content and re-watches).
 */
export const completionOf = (positionMs: number, durationMs: number) => {
  if (!(durationMs > 0)) return { completionPercentage: 0, completed: false };
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  return {
    completionPercentage: Math.round(ratio * 1000) / 10,
    completed: ratio >= 0.95,
  };
};

export const dailyStatId = (uid: string, nowMs: number): string => `${uid}__${Math.floor(nowMs / DAY_MS)}`;

export type RecorderSink = {
  writeSession: (data: WatchSessionDoc, mode: 'create' | 'update') => Promise<void>;
  addDailyStat: (watchMs: number) => Promise<void>;
};

const firestoreSink = (uid: string, installationId: string): RecorderSink => {
  const db = getFirestore();
  return {
    async writeSession(data, mode) {
      const ref = doc(db, 'watchSessions', data.sessionId);
      if (mode === 'create') await setDoc(ref, data);
      else await updateDoc(ref, data as unknown as Record<string, unknown>);
    },
    async addDailyStat(watchMs) {
      const ref = doc(db, 'userDailyStats', dailyStatId(uid, Date.now()));
      const existing = (await getDoc(ref)).data() as { watchMs?: number; sessions?: number } | undefined;
      await setDoc(
        ref,
        {
          uid,
          dateEpochDay: Math.floor(Date.now() / DAY_MS),
          watchMs: Math.min(DAY_MS, (existing?.watchMs ?? 0) + watchMs),
          sessions: Math.min(200, (existing?.sessions ?? 0) + 1),
        },
        { merge: true },
      );
    },
  };
};

/**
 * One per playback. Positions are fed in from the existing continue-watching seam; the
 * session document opens the first time a real duration is known, progress is written at
 * most every 30 s, and teardown finalizes.
 */
export class WatchSessionRecorder {
  private opened = false;
  private closed = false;
  private lastPositionMs: number | null = null;
  private watchedMs = 0;
  private durationMs = 0;
  private lastFlushAt = 0;
  private readonly startedAt = Date.now();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly identity: ContentIdentity,
    private readonly uid: string,
    private readonly installationId: Promise<string>,
    private readonly sinkFor: (installationId: string) => RecorderSink,
  ) {}

  note(positionMs: number, durationMs: number): void {
    if (this.closed || !(durationMs > 0)) return;
    this.watchedMs += clampDelta(positionMs, this.lastPositionMs);
    this.lastPositionMs = positionMs;
    this.durationMs = Math.max(this.durationMs, durationMs);

    if (!this.opened) {
      this.opened = true;
      this.lastFlushAt = Date.now();
      this.enqueue('create');
      return;
    }
    if (Date.now() - this.lastFlushAt < FLUSH_INTERVAL_MS) return;
    this.lastFlushAt = Date.now();
    this.enqueue('update');
  }

  finalize(): void {
    if (this.closed) return;
    this.closed = true;
    // A title that never reported a duration was never really watched; writing a zero
    // session would pollute the admin's completion and DAU figures.
    if (!this.opened) return;
    const watchedMs = this.watchedMs;
    this.enqueue('update', (sink) => sink.addDailyStat(watchedMs));
  }

  private build(mode: 'create' | 'update', installationId: string): WatchSessionDoc {
    const now = Date.now();
    const positionMs = this.lastPositionMs ?? 0;
    const durationMs = this.durationMs;
    // Clamped twice: once so a long seek cannot inflate watch time, and once because the
    // rules refuse any session whose watch duration exceeds its runtime.
    const watchDurationMs = Math.min(this.watchedMs, durationMs);
    const { completionPercentage, completed } = completionOf(positionMs, durationMs);
    return {
      sessionId: `${this.uid}__${this.startedAt}`,
      uid: this.uid,
      state: 'open',
      contentId: this.identity.contentId,
      contentTitle: this.identity.contentTitle,
      contentType: this.identity.contentType,
      startedAt: this.startedAt,
      endedAt: null,
      positionMs,
      durationMs,
      watchDurationMs,
      completionPercentage,
      completed,
      installationId,
      appVersion: getAppVersion(),
      updatedAt: now,
    } as WatchSessionDoc;
  }

  private enqueue(mode: 'create' | 'update', extra?: (sink: RecorderSink) => Promise<void>): void {
    this.chain = this.chain
      .then(async () => {
        const installationId = await this.installationId;
        const sink = this.sinkFor(installationId);
        const data = this.build(mode, installationId);
        if (mode === 'update' && this.closed) {
          data.state = 'finalized';
          data.endedAt = Date.now();
        }
        await sink.writeSession(data, mode);
        if (extra) await extra(sink);
      })
      .catch(() => {
        // Swallowed on purpose: see the file header.
      });
  }
}

/**
 * Opens a recorder for one playback, or null when nobody is signed in — analytics follow
 * the account, and an anonymous session has nowhere to be filed.
 */
export const openWatchSession = async (
  identity: ContentIdentity | null,
): Promise<WatchSessionRecorder | null> => {
  if (!identity) return null;
  const uid = currentUserUid();
  if (!uid) return null;
  return new WatchSessionRecorder(
    identity,
    uid,
    getInstallationId(),
    (installationId) => firestoreSink(uid, installationId),
  );
};
