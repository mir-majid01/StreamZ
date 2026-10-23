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
  /**
   * The audio formats the player was offered, as full MIME strings, e.g. `['audio/ac-3']`.
   *
   * react-native-video fills a track's `type` from `Format.sampleMimeType`, so this is the
   * broadcaster's own answer about what its audio is — the only codec evidence this app can get
   * without parsing the container itself, which three attempts at on-PC container sniffing have now
   * failed to do reliably. It turns "no sound" into either "this stream carries no audio" or "this
   * stream carries Dolby Digital and this phone has no decoder for it", and those two need
   * completely different fixes.
   */
  audioFormats: string[];
  /**
   * Whether the player marked any audio track as selected.
   *
   * `true` with a decodable format and still no sound points at something this app controls
   * (volume, audio focus, routing) rather than at the feed — so the distinction has to be kept.
   */
  audioSelected: boolean | null;
}

/**
 * Codecs an Android phone is not guaranteed to decode. AAC is the one live IPTV audio format that
 * is safe everywhere; Dolby and DTS profiles need a licensed decoder on the device, and MPEG
 * Layer I/II audio has no MediaCodec decoder at all, so a stream carrying them plays in silence.
 */
const OFTEN_UNDECODABLE = [
  // Longest patterns first: `audio/eac-3` also contains `ac-3`, and reading that first would
  // tell the user "Dolby Digital" when the stream is actually Dolby Digital Plus.
  ['eac-3', 'Dolby Digital Plus'],
  ['ec-3', 'Dolby Digital Plus'],
  ['dtshd', 'DTS-HD'],
  ['dts-hd', 'DTS-HD'],
  ['ac-3', 'Dolby Digital'],
  ['dts', 'DTS'],
  ['mp2', 'MPEG Layer II'],
  ['mp1', 'MPEG Layer I'],
] as const;

/** The friendly name of a format this phone may not have a decoder for, or null if it is safe. */
export const undecodableAudioFormat = (formats: readonly string[]): string | null => {
  for (const format of formats) {
    const mime = format.toLowerCase();
    if (!mime.startsWith('audio/')) continue;
    for (const [needle, label] of OFTEN_UNDECODABLE) {
      if (mime.includes(needle)) return label;
    }
  }
  return null;
};

/** Every audio format the player reported, as full MIME strings, deduplicated. */
export const audioFormatsOf = (
  tracks: readonly { type?: string | null; selected?: boolean | null }[],
): string[] => [
  ...new Set(
    tracks
      .map((t) => (t.type ?? '').toLowerCase())
      .filter((t) => t.startsWith('audio/')),
  ),
];

/** Whether any reported audio track is the one the player selected; null when none were reported. */
export const anyAudioTrackSelected = (
  tracks: readonly { selected?: boolean | null }[],
): boolean | null =>
  tracks.length === 0 ? null : tracks.some((t) => t.selected === true);

export const EMPTY_LIVE_TELEMETRY: LivePlaybackTelemetry = {
  firstFrameMs: null,
  rebufferCount: 0,
  rebufferTotalMs: 0,
  playlistLatencyMs: null,
  audioTrackCount: null,
  audioFormats: [],
  audioSelected: null,
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
    const names = telemetry.audioFormats.map((f) => f.replace(/^audio\//, ''));
    const suffix = names.length ? ` (${names.join(', ')})` : '';
    parts.push(
      `${telemetry.audioTrackCount} audio track${telemetry.audioTrackCount === 1 ? '' : 's'}${suffix}`,
    );
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

/**
 * What to say when the picture is fine and the stream brought no sound.
 *
 * This is deliberately not a playback failure: nothing broke, so the failure panel — and with it the
 * whole telemetry line — never appears, and the viewer is left with a moving picture, no audio and
 * no explanation. The player's own report is the only evidence the app has, so it is spoken to the
 * user instead of buried.
 *
 * It claims only what was observed. Two causes are named, because the player can tell them apart:
 * a stream with no audio track at all, and a stream whose audio is a format this phone may not
 * carry a licensed decoder for. A third possibility — audio selected and decodable, still silent —
 * is left unspoken rather than guessed at, because nothing here can prove it from the player's
 * report and a wrong diagnosis on screen is worse than none.
 */
export const liveSilentStreamNotice = (telemetry: LivePlaybackTelemetry): string | null => {
  if (telemetry.audioTrackCount === null) return null;
  if (telemetry.audioTrackCount === 0) {
    return 'No sound: this channel is not sending any audio.';
  }
  const label = undecodableAudioFormat(telemetry.audioFormats);
  if (label !== null) {
    return `No sound: this channel's audio is ${label}, which this phone may not be able to decode.`;
  }
  return null;
};
