// The recorder module reaches Firestore; only the pure arithmetic and the recorder's own
// sequencing are under test here, so the native SDK stays mocked.
jest.mock('@react-native-firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  getFirestore: jest.fn(() => ({})),
}));
jest.mock('@react-native-firebase/analytics', () => ({
  getAnalytics: jest.fn(() => ({})),
  logEvent: jest.fn(async () => undefined),
}));
jest.mock('@/src/firebase/init', () => ({ currentUserUid: jest.fn(() => 'u1') }));
jest.mock('@/src/firebase/installation/installationId', () => ({
  getInstallationId: jest.fn(async () => 'inst-00000001'),
}));
jest.mock('@/src/utils/appVersion', () => ({ getAppVersion: () => '0.1.0' }));

import {
  clampDelta,
  completionOf,
  dailyStatId,
  WatchSessionRecorder,
  type RecorderSink,
} from '@/src/firebase/analytics/watchSession';
import type { WatchSessionDoc } from '@/src/firebase/models';
import { contentIdentityFor } from '@/src/firebase/analytics/contentIdentity';

const identity = { contentId: 'tmdb:603', contentTitle: 'Sintel', contentType: 'movie' } as const;

const makeSink = () => {
  const writes: { mode: string; data: WatchSessionDoc }[] = [];
  const rolls: number[] = [];
  const sink: RecorderSink = {
    writeSession: async (data, mode) => {
      writes.push({ mode, data });
    },
    addDailyStat: async (watchMs) => {
      rolls.push(watchMs);
    },
  };
  return { sink, writes, rolls };
};

const flush = async () => {
  await jest.advanceTimersByTimeAsync(1);
};

describe('contentIdentity', () => {
  it('ids a movie by its TMDB id', () => {
    expect(contentIdentityFor({ id: 603, title: 'Sintel', overview: '', poster_path: null } as never)).toEqual({
      contentId: 'tmdb:603',
      contentTitle: 'Sintel',
      contentType: 'movie',
    });
  });

  it('ids an episode separately from its series', () => {
    const show = { id: 1396, name: 'Breaking Bad', overview: '', poster_path: null } as never;
    expect(contentIdentityFor(show)).toMatchObject({ contentId: 'tmdb:1396', contentType: 'series' });
    expect(contentIdentityFor(show, 5, 7)).toMatchObject({
      contentId: 'tmdb:1396:s05e07',
      contentTitle: 'Breaking Bad S05E07',
      contentType: 'episode',
    });
  });

  it('returns null when there is nothing to identify', () => {
    expect(contentIdentityFor(null)).toBeNull();
    expect(contentIdentityFor(undefined)).toBeNull();
    expect(contentIdentityFor({ id: 'not-a-number' } as never)).toBeNull();
  });
});

describe('watch time arithmetic', () => {
  it('counts forward movement and nothing else', () => {
    expect(clampDelta(1000, null)).toBe(0);
    expect(clampDelta(5000, 1000)).toBe(4000);
    expect(clampDelta(1000, 5000)).toBe(0);
    // A seek past 40 minutes of a show is not 40 minutes of attention.
    expect(clampDelta(2_400_000, 1000)).toBe(10_000);
  });

  it('derives completion without a known duration', () => {
    expect(completionOf(1000, 0)).toEqual({ completionPercentage: 0, completed: false });
    expect(completionOf(1000, 2000).completionPercentage).toBe(50);
    expect(completionOf(1950, 2000).completed).toBe(true);
  });

  it('files daily stats by epoch day under the uid', () => {
    expect(dailyStatId('u1', 86_400_000 * 3 + 5)).toBe('u1__3');
  });
});

describe('WatchSessionRecorder', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const open = (sink: RecorderSink) =>
    new WatchSessionRecorder(identity, 'u1', Promise.resolve('inst-00000001'), () => sink);

  it('writes nothing until a real duration is known', async () => {
    const { sink, writes } = makeSink();
    const recorder = open(sink);
    recorder.note(5000, 0);
    recorder.finalize();
    await flush();
    expect(writes).toHaveLength(0);
  });

  it('opens once, then throttles progress', async () => {
    const { sink, writes } = makeSink();
    const recorder = open(sink);
    recorder.note(1000, 60_000);
    recorder.note(2000, 60_000);
    await flush();
    expect(writes.filter((w) => w.mode === 'create')).toHaveLength(1);
    expect(writes.filter((w) => w.mode === 'update')).toHaveLength(0);
    expect(writes[0].data.state).toBe('open');

    jest.advanceTimersByTime(31_000);
    recorder.note(3000, 60_000);
    await flush();
    expect(writes.filter((w) => w.mode === 'update')).toHaveLength(1);
  });

  it('finalizes with the real runtime and rolls the day up exactly once', async () => {
    const { sink, writes, rolls } = makeSink();
    const recorder = open(sink);
    recorder.note(0, 60_000);
    for (let second = 10; second <= 40; second += 10) recorder.note(second * 1000, 60_000);
    await flush();
    recorder.finalize();
    await flush();

    const last = writes[writes.length - 1].data;
    expect(last.state).toBe('finalized');
    expect(last.endedAt).not.toBeNull();
    // Four 10-second steps forward, and never more than the title runs.
    expect(last.watchDurationMs).toBe(40_000);
    expect(rolls).toHaveLength(1);
    recorder.finalize();
    await flush();
    expect(rolls).toHaveLength(1);
  });

  it('never lets watch time exceed the runtime the rules will accept', async () => {
    const { sink, writes } = makeSink();
    const recorder = open(sink);
    recorder.note(1000, 2000);
    for (let i = 0; i < 40; i += 1) {
      jest.advanceTimersByTime(31_000);
      recorder.note(1000 + i * 10_000, 2000);
    }
    await flush();
    for (const write of writes) {
      expect(write.data.watchDurationMs).toBeLessThanOrEqual(write.data.durationMs);
    }
  });

  it('is idempotent after close', async () => {
    const { sink, writes } = makeSink();
    const recorder = open(sink);
    recorder.note(1000, 60_000);
    await flush();
    recorder.finalize();
    await flush();
    const count = writes.length;
    recorder.note(99_000, 60_000);
    recorder.finalize();
    await flush();
    expect(writes).toHaveLength(count);
  });
});
