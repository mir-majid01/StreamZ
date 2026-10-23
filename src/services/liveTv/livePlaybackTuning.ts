import type { BufferConfig } from 'react-native-video';

/**
 * The live player used to run on whatever ExoPlayer's defaults happened to be: a media3
 * default `minBufferMs` that favours VOD smoothness, no live offset target at all, and
 * nothing on the screen that said how long the tune took or how often it stalled. The
 * result was a player that could sit many seconds behind the live edge on a good network
 * and gave no number to argue with on a bad one.
 *
 * These are live numbers, not the VOD ones in `PlayerCore` (`deviceRecommendations` sizes a
 * 30–300s forward buffer for films). A live stream wants the opposite: enough buffer to
 * survive a short stall, a bounded offset behind the edge, and a small speed window in
 * which the player may correct its own drift. Every value is a bound, not a best guess at
 * "more is better" — unbounded read-ahead is what turns a two-second hiccup into a
 * thirty-second lag that never comes back.
 *
 * `targetOffsetMs` is the measured quantity to argue about. 12s is deliberately above
 * media3's 3-target-duration default for unconfigured playlists: a 4s HLS target then
 * drifts to ~12s anyway, and naming it means the number can be tuned from one place
 * instead of inherited from the broadcaster's segment length.
 */
export const LIVE_BUFFER_CONFIG: BufferConfig = {
  /** Stop reading ahead after this much media; also the stall budget. */
  maxBufferMs: 30_000,
  /** Refill to here after a stall, so the resume does not immediately stall again. */
  minBufferMs: 12_000,
  /** Enough media to start; live starts matter more than the first second being perfect. */
  bufferForPlaybackMs: 1_500,
  /** After a rebuffer, rebuild a little more before resuming rather than resuming on fumes. */
  bufferForPlaybackAfterRebufferMs: 4_000,
  // No `cacheSizeMB` on purpose: a live stream is unbounded and never replayed, so a disk
  // cache would grow without ever being read.
  live: {
    /** Sit this far behind the live edge. */
    targetOffsetMs: 12_000,
    /** Drift correction window; outside this the player jumps instead of slewing. */
    minOffsetMs: 8_000,
    maxOffsetMs: 30_000,
    /** Catch up at most 8%, slow down at most 3%: audible only as smooth correction. */
    maxPlaybackSpeed: 1.08,
    minPlaybackSpeed: 0.97,
  },
};

/**
 * iOS has no `bufferConfig`; AVPlayer takes one forward-buffer duration in seconds. It is
 * set to the same 12s target so both platforms sit the same distance behind the edge.
 */
export const LIVE_FORWARD_BUFFER_SECONDS = 12;

/** One tune's observable timeline. Every field is a measurement or null, never a guess. */
export interface LivePlaybackTelemetry {
  /** ms from the player being asked for a source to its first rendered frame. */
  firstFrameMs: number | null;
  /** How many times playback stalled after it had started. */
  rebufferCount: number;
  /** Total ms spent stalled after playback had started. */
  rebufferTotalMs: number;
  /** The journal's own read of the same stream, when the retry path ran. */
  playlistLatencyMs: number | null;
  /**
   * How many audio tracks the player found in this tune, or null when it never reported.
   *
   * `0` is the answer that separates two failures which look identical on screen and need
   * different fixes: a feed that carries no audio at all (nothing the app can decode) against a
   * feed whose audio is present but was dropped by selection or by a missing decoder. It is
   * recorded even when it is zero, and even when playback is fine, because "video with no sound"
   * cannot be diagnosed from a screenshot.
   */
  audioTrackCount: number | null;
}

export const EMPTY_LIVE_TELEMETRY: LivePlaybackTelemetry = {
  firstFrameMs: null,
  rebufferCount: 0,
  rebufferTotalMs: 0,
  playlistLatencyMs: null,
  audioTrackCount: null,
};

/**
 * A single line for the failure panel. Omitted fields are omitted: a failed tune that never
 * produced a frame has no first-frame time, and printing "0 ms" would be a measurement it
 * did not make.
 */
export const formatLiveTelemetry = (
  telemetry: LivePlaybackTelemetry,
  options: { rebuffering?: boolean } = {},
): string => {
  const parts: string[] = [];
  if (telemetry.firstFrameMs !== null) parts.push(`first frame ${telemetry.firstFrameMs} ms`);
  if (telemetry.playlistLatencyMs !== null) parts.push(`playlist ${telemetry.playlistLatencyMs} ms`);
  // Printed even when it is zero: "the player found no audio track" is the finding, not an absence.
  if (telemetry.audioTrackCount !== null) {
    parts.push(`${telemetry.audioTrackCount} audio track${telemetry.audioTrackCount === 1 ? '' : 's'}`);
  }
  if (telemetry.rebufferCount > 0) {
    parts.push(
      `${telemetry.rebufferCount} rebuffer${telemetry.rebufferCount === 1 ? '' : 's'} (${telemetry.rebufferTotalMs} ms)`,
    );
  } else if (telemetry.firstFrameMs !== null) {
    parts.push('no rebuffers');
  }
  if (options.rebuffering) parts.push('buffering now');
  return parts.join(' · ');
};
