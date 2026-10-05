import { useCallback, useEffect, useRef } from 'react';
import { contentIdentityFor } from '@/src/firebase/analytics/contentIdentity';
import { openWatchSession, type WatchSessionRecorder } from '@/src/firebase/analytics/watchSession';
import type { MediaItem } from '@/src/types';

/**
 * One watch session per player mount.
 *
 * Positions arrive in **seconds** — react-native-video reports them that way — and are
 * converted here so everything that reaches Firestore is epoch-milliseconds, matching the
 * rest of the schema. The recorder opens asynchronously; notes made in that first moment are
 * dropped rather than buffered, which costs at most a couple of seconds of watch time and
 * avoids a queue that has to be drained against a document that may never open.
 */
export const useWatchSession = (
  item: MediaItem | null | undefined,
  season?: number | null,
  episode?: number | null,
) => {
  const recorderRef = useRef<WatchSessionRecorder | null>(null);

  useEffect(() => {
    let settled: WatchSessionRecorder | null = null;
    let cancelled = false;
    void openWatchSession(contentIdentityFor(item, season, episode)).then((recorder) => {
      if (!recorder) return;
      if (cancelled) {
        // The player unmounted inside the open window; close what we started rather than
        // leaving an 'open' session that no scheduled function will ever finalize.
        recorder.finalize();
        return;
      }
      settled = recorder;
      recorderRef.current = recorder;
    });
    return () => {
      cancelled = true;
      recorderRef.current = null;
      settled?.finalize();
    };
  }, [item, season, episode]);

  const note = useCallback((positionSeconds: number, durationSeconds: number) => {
    if (!(durationSeconds > 0)) return;
    recorderRef.current?.note(positionSeconds * 1000, durationSeconds * 1000);
  }, []);

  return { note };
};
