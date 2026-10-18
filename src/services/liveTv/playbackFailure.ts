/**
 * Turns a react-native-video error payload into a named failure, one plain-language sentence,
 * and a yes/no on whether a retry can plausibly fix it.
 *
 * Why the codes are trustworthy: `ReactExoplayerView.onPlayerError` (line 1993 of
 * node_modules/react-native-video/android/src/main/java/com/brentvatne/exoplayer/ReactExoplayerView.java,
 * v6.19.2) builds the payload from media3 itself —
 *
 *   String errorString = "ExoPlaybackException: " + PlaybackException.getErrorCodeName(e.errorCode);
 *   String errorCode   = "2" + e.errorCode;
 *
 * so `errorString` carries media3's own constant name and `errorCode` is that constant with the
 * digit 2 concatenated in front of it. The names and numbers below were read out of the exact
 * dependency the build resolves — `androidx.media3:media3-common:1.11.1`,
 * `androidx.media3.common.PlaybackException`, via `javap -constants` — not from prose:
 * media3 numbers its codes in decimal (ERROR_CODE_IO_NETWORK_CONNECTION_FAILED = 2001), which is
 * why "Star Sports 1 (576p)" reached the screen as `22001`.
 *
 * Three names the task asked for are NOT reachable from this library and are deliberately absent
 * (asserting them would be inventing a code):
 *   ERROR_CODE_IO_PERMISSION_DENIED — media3's constant is ERROR_CODE_IO_NO_PERMISSION.
 *       (A separate ERROR_CODE_PERMISSION_DENIED = -4 exists, but it is a SessionError /
 *       MediaController code; a plain ExoPlayer never raises it through onPlayerError.)
 *   ERROR_CODE_DECODER_FAILED — no such constant. The family is ERROR_CODE_DECODER_INIT_FAILED,
 *       ERROR_CODE_DECODER_QUERY_FAILED, ERROR_CODE_DECODING_FAILED.
 *   ERROR_CODE_EXTENSION_MISSING — no such constant in media3 1.11.1; a missing decoder
 *       extension surfaces as ERROR_CODE_DECODING_FORMAT_UNSUPPORTED (or
 *       ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED), which are mapped below.
 * Codes that exist in media3 1.11.1 and are deliberately left unmapped, because reading them would
 * be guessing rather than mapping: the DRM family (6000-6008 — the live path has no DRM, and
 * react-native-video already re-initialises the player itself for those), ERROR_CODE_AUDIO_TRACK_-
 * OFFLOAD_* (5003/5004, an audio-session concern), ERROR_CODE_DECODING_RESOURCES_RECLAIMED (4006,
 * the OS taking memory back — a device-state fault, not a stream fault), ERROR_CODE_IO_READ_-
 * POSITION_OUT_OF_RANGE (2008, a byte-range error that names none of these nine buckets),
 * ERROR_CODE_FAILED_RUNTIME_CHECK (1004) and ERROR_CODE_UNSPECIFIED (1000), which are the player
 * saying "something else went wrong", and the negative SessionError codes (-100 DISCONNECTED,
 * -102 AUTHENTICATION_EXPIRED and friends) that a plain ExoPlayer never raises. Anything unmapped
 * still lands in `unknown` with its code on screen, which is the honest answer.
 *
 * The classifier is pure: no fetch, no timers, no native calls. The optional probe result is an
 * observation somebody else already made, so the mapping stays testable — and so a probe that
 * says nothing cannot make the diagnosis louder than the evidence.
 */
import {
  playbackErrorDiagnostics,
  type PlayerErrorPayload,
} from '@/src/services/liveTv/playbackError';
import {
  resourceKindFromProbe,
  type StreamProbeResult,
  type StreamResourceKind,
} from '@/src/services/liveTv/streamProbe';

export type PlaybackFailureCategory =
  /** The stream host could not be reached. "dns" is claimed only on a DNS-specific signal. */
  | 'dns-or-unreachable'
  /** Something answered, but not within the deadline — the player's or our own. */
  | 'connection-timeout'
  /** The server answered with an error status that is not a refusal. */
  | 'http-error'
  /** The bytes are a format this device, or this build of the player, cannot read. */
  | 'unsupported-format'
  /** The playlist / manifest itself could not be parsed, or the media data was unreadable. */
  | 'invalid-manifest'
  /** The live window moved on while the player was behind it. */
  | 'stream-expired'
  /** The server reached the point of deciding, and said no. */
  | 'access-rejected'
  /** 404 / 410: the address the catalogue published is no longer served. */
  | 'stream-gone'
  /** 429: the server is throttling this client, and will say more later. */
  | 'rate-limited'
  /** 5xx: the publisher's own origin failed. Not this app, and not the user's network. */
  | 'upstream-unreachable'
  /** Playback was running and the connection went away underneath it. */
  | 'network-lost-mid-stream'
  /** Nothing observed supports any of the above. */
  | 'unknown';

export interface PlaybackFailure {
  category: PlaybackFailureCategory;
  /** Plain-language sentence for the screen. Never contains the stream URL or a token. */
  message: string;
  /** True only where replaying the same tune can plausibly come out differently. */
  transient: boolean;
  /** media3's constant name, when the payload carried one. Diagnostics, not UI. */
  codeName: string | null;
  /** media3's own number, before react-native-video prefixed it with "2". */
  code: number | null;
  /** Host of the stream URL — public information, safe to name on screen. */
  host: string | null;
  /**
   * The HTTP status, when something actually read one. media3 does not put the status in the
   * payload for `ERROR_CODE_IO_BAD_HTTP_STATUS` (ReactExoplayerView.java:1994 sends only the name
   * and `"2"+code`). A status named by the native exception is retained too, when parseable. Null
   * means "we do not know the status", and the copy has to say that instead of inventing a reason.
   */
  status: number | null;
  /** Sanitized native exception text, when the platform supplied one. */
  nativeException: string | null;
  /** Redacted final response URL after redirects, when fetch exposed it. */
  finalUrl: string | null;
  /** Response metadata captured by the retry-path GET. */
  contentType: string | null;
  bodyPreview: string | null;
  bodyPreviewTruncated: boolean;
  resourceKind: StreamResourceKind | null;
  /** True when the retry-path GET received a successful 2xx response. */
  probeSucceeded: boolean;
  /** True when a native player error remains after a successful 2xx probe. */
  probeMismatch: boolean;
  /**
   * How long to wait before the next automatic attempt, when the server asked for a wait. Already
   * clamped by this file; null means use the retry schedule's own cadence.
   */
  backoffMs: number | null;
}

export interface PlaybackFailureInput {
  payload: PlayerErrorPayload;
  /** The URL that was handed to the player, if one was resolved at all. */
  url?: string | null;
  /** Observation from the retry-path probe. Absent for the first playback. */
  probe?: StreamProbeResult | null;
  /**
   * Did the player ever report the stream loaded? Distinguishes "the stream never opened" from
   * "the stream died under a running player", which media3's catch-all IO codes do not.
   */
  playbackStarted?: boolean;
}

/** media3 name -> its own number. Verified against media3-common 1.11.1 by `javap -constants`. */
const MEDIA3_CODE_BY_NAME: Readonly<Record<string, number>> = {
  ERROR_CODE_BEHIND_LIVE_WINDOW: 1002,
  ERROR_CODE_TIMEOUT: 1003,
  ERROR_CODE_IO_UNSPECIFIED: 2000,
  ERROR_CODE_IO_NETWORK_CONNECTION_FAILED: 2001,
  ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT: 2002,
  ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE: 2003,
  ERROR_CODE_IO_BAD_HTTP_STATUS: 2004,
  ERROR_CODE_IO_FILE_NOT_FOUND: 2005,
  ERROR_CODE_IO_NO_PERMISSION: 2006,
  ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED: 2007,
  ERROR_CODE_PARSING_CONTAINER_MALFORMED: 3001,
  ERROR_CODE_PARSING_MANIFEST_MALFORMED: 3002,
  ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED: 3003,
  ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED: 3004,
  ERROR_CODE_DECODER_INIT_FAILED: 4001,
  ERROR_CODE_DECODER_QUERY_FAILED: 4002,
  ERROR_CODE_DECODING_FAILED: 4003,
  ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES: 4004,
  ERROR_CODE_DECODING_FORMAT_UNSUPPORTED: 4005,
  // The audio renderers. A channel carrying AC-3/E-AC-3 audio reaches these on devices without a
  // decoder for it, which is a format fact about the stream, not a network one.
  ERROR_CODE_AUDIO_TRACK_INIT_FAILED: 5001,
  ERROR_CODE_AUDIO_TRACK_WRITE_FAILED: 5002,
};

/**
 * The categories a retry can plausibly change. A dead host stays dead, a refused token stays
 * refused, and an address the publisher removed comes back 404 on every attempt — so nothing in
 * that group is here. `rate-limited` and `upstream-unreachable` are, because both describe a
 * server that is asking to be approached again later, which is exactly what a bounded backoff is.
 */
const TRANSIENT_CATEGORIES: ReadonlySet<PlaybackFailureCategory> = new Set([
  'connection-timeout',
  'network-lost-mid-stream',
  'stream-expired',
  'rate-limited',
  'upstream-unreachable',
]);

const CATEGORY_BY_CODE_NAME: Readonly<Record<string, PlaybackFailureCategory>> = {
  ERROR_CODE_BEHIND_LIVE_WINDOW: 'stream-expired',
  ERROR_CODE_TIMEOUT: 'connection-timeout',
  ERROR_CODE_IO_NETWORK_CONNECTION_FAILED: 'dns-or-unreachable',
  ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT: 'connection-timeout',
  ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE: 'unsupported-format',
  ERROR_CODE_IO_BAD_HTTP_STATUS: 'http-error',
  ERROR_CODE_IO_FILE_NOT_FOUND: 'stream-gone',
  ERROR_CODE_IO_NO_PERMISSION: 'access-rejected',
  ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED: 'access-rejected',
  ERROR_CODE_PARSING_CONTAINER_MALFORMED: 'invalid-manifest',
  ERROR_CODE_PARSING_MANIFEST_MALFORMED: 'invalid-manifest',
  ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED: 'unsupported-format',
  ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED: 'unsupported-format',
  ERROR_CODE_DECODER_INIT_FAILED: 'unsupported-format',
  ERROR_CODE_DECODER_QUERY_FAILED: 'unsupported-format',
  ERROR_CODE_DECODING_FAILED: 'unsupported-format',
  ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES: 'unsupported-format',
  ERROR_CODE_DECODING_FORMAT_UNSUPPORTED: 'unsupported-format',
  ERROR_CODE_AUDIO_TRACK_INIT_FAILED: 'unsupported-format',
  ERROR_CODE_AUDIO_TRACK_WRITE_FAILED: 'unsupported-format',
};

/**
 * Which bucket an HTTP status belongs in. This is the whole reason the probe exists on the retry
 * path: media3 hands the app "bad HTTP status" and the number, but not the status itself, and
 * "the publisher took the feed down", "you are being throttled" and "the origin is on fire" are
 * three different facts with three different answers to "will trying again help".
 *
 * 408 is treated as transient (a timeout with a status attached), and 425 too early-content is
 * left to fall through as a plain http-error rather than guessed at.
 */
export const categoryFromHttpStatus = (status: number): PlaybackFailureCategory => {
  // A successful response is evidence against an HTTP failure. In particular, a retry-path GET
  // that gets 200 must never turn the player's earlier error into a made-up HTTP diagnosis.
  if (status >= 100 && status <= 399) return 'unknown';
  if (status === 401 || status === 403 || status === 407) return 'access-rejected';
  if (status === 404 || status === 410) return 'stream-gone';
  if (status === 429) return 'rate-limited';
  if (status === 408) return 'connection-timeout';
  if (status >= 500 && status <= 599) return 'upstream-unreachable';
  return 'http-error';
};

/**
 * A server asking for an hour of patience is not obeyed for an hour. The floor keeps a hammering
 * client from re-asking in under a second; the ceiling keeps a user from sitting on an error
 * screen while the app pretends to be waiting. Outside those bounds the schedule's own cadence
 * (900 ms, then 1800 ms) is used, because a wait the app made up is at least an honest one.
 */
export const MIN_RETRY_BACKOFF_MS = 1_000;
export const MAX_RETRY_BACKOFF_MS = 20_000;

const clampBackoffMs = (seconds: number | null | undefined): number | null => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.round(seconds * 1000);
  if (ms < MIN_RETRY_BACKOFF_MS) return MIN_RETRY_BACKOFF_MS;
  if (ms > MAX_RETRY_BACKOFF_MS) return MAX_RETRY_BACKOFF_MS;
  return ms;
};

const hostOf = (url?: string | null): string | null => {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host ? host.toLowerCase() : null;
  } catch {
    // A malformed URL is not worth a diagnosis built on top of it, and echoing the string back
    // could echo a signed path with it.
    return null;
  }
};

/** `ExoPlaybackException: ERROR_CODE_IO_NETWORK_CONNECTION_FAILED` -> the constant name. */
const nameFromErrorString = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const match = /ERROR_CODE_[A-Z0-9_]+/.exec(raw);
  if (!match) return null;
  // `PlaybackException.getErrorCodeName` answers "invalid error code" for anything outside its
  // switch; a name that is not in the verified table is not evidence of anything.
  return Object.prototype.hasOwnProperty.call(MEDIA3_CODE_BY_NAME, match[0]) ? match[0] : null;
};

/**
 * Reverses `"2" + e.errorCode` (ReactExoplayerView.java:1995). Deliberately strict:
 * react-native-video also emits its own four-digit codes — 1001 "Failed to initialize Player",
 * 3003 for an unsupported DRM scheme, 3006 from a source build failure — and 3003 collides with
 * media3's ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED, so a bare number is never read as media3's.
 */
const media3CodeFromPayload = (payload: PlayerErrorPayload): number | null => {
  const raw = payload.error?.errorCode?.trim();
  if (!raw || !/^2\d{4}$/.test(raw)) return null;
  const code = Number(raw.slice(1));
  return Object.values(MEDIA3_CODE_BY_NAME).includes(code) ? code : null;
};

const nameFromCode = (code: number): string | null =>
  Object.keys(MEDIA3_CODE_BY_NAME).find((name) => MEDIA3_CODE_BY_NAME[name] === code) ?? null;

const sentence = (
  category: PlaybackFailureCategory,
  parts: {
    host: string | null;
    /** The status a probe read, or null when nothing read one. Never a guess. */
    status?: number | null;
    contentType?: string | null;
    probe?: StreamProbeResult | null;
    media3Name: string | null;
    probeSucceeded: boolean;
  },
): string => {
  const who = parts.host ?? 'This channel';
  switch (category) {
    case 'dns-or-unreachable':
      // Three different amounts of evidence, three different sentences. The DNS wording is
      // reserved for the case where something actually named a resolution failure.
      if (parts.probe?.observation === 'host-did-not-resolve') {
        return `${who} does not resolve to an address. Its domain is gone, or this network's DNS will not answer for it.`;
      }
      if (parts.probe?.observation === 'socket-could-not-open') {
        return `A connection to ${who} could not be opened. Its server is offline or refusing traffic.`;
      }
      if (parts.probe?.observation === 'answered') {
        return `${who} answers an ordinary request but not the player, so the stream path itself is failing.`;
      }
      return `Could not reach ${who}. That channel's own server is offline or unreachable from here.`;
    case 'connection-timeout':
      if (parts.probe?.observation === 'timed-out') {
        return `${who} had not answered after ${parts.probe.ms}ms. It is up but too busy or too far to stream from right now.`;
      }
      return `${who} did not answer in time. Its server is overloaded, or the route to it is congested.`;
    case 'http-error':
      // No status means no claim. media3 says "the server answered a bad status" and does not
      // send the status; inventing "broken or taken down" from that is exactly the blanket label
      // this screen is being fixed for.
      return parts.status
        ? `${who} answered with HTTP ${parts.status}, which this app has no rule for yet. The code below is what makes it reportable.`
        : `${who} answered the player with an error status. The app asked for the reason and could not read it either, so nothing more specific than that is claimed.`;
    case 'stream-gone':
      return parts.status === 410
        ? `${who} reports this stream has been removed (HTTP 410). The address the channel list publishes is no longer valid, and asking it again will not bring it back.`
        : `${who} has no stream at that address (HTTP 404). The channel list points somewhere the publisher stopped serving — a stale entry, and not a fault of this device or this network.`;
    case 'rate-limited':
      return `${who} is throttling requests right now (HTTP 429). Trying again after a short wait is the fix; using a different channel meanwhile works too.`;
    case 'upstream-unreachable':
      return `${who}'s own server failed (HTTP ${parts.status ?? '5xx'}). The stream exists and the app reached it — the publisher's origin is the part that is down.`;
    case 'unsupported-format':
      if (parts.media3Name === 'ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE') {
        return `${who} answered with ${parts.contentType || 'a non-media content type'} instead of a stream. Its URL no longer points at media.`;
      }
      return `${who} broadcasts in a format this device cannot play.`;
    case 'invalid-manifest':
      return parts.media3Name === 'ERROR_CODE_PARSING_CONTAINER_MALFORMED'
        ? `The data ${who} sent is not a readable stream. The feed is broken at the publisher.`
        : `${who}'s stream index could not be parsed. The feed is broken at the publisher.`;
    case 'stream-expired':
      return `This live feed moved past the player's buffer. Rejoining at the live edge normally fixes it.`;
    case 'access-rejected':
      if (parts.media3Name === 'ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED') {
        return `${who} only serves plain HTTP, and this device will not play an unsecured stream.`;
      }
      return parts.status
        ? `${who} refused this device (HTTP ${parts.status}). The stream is geo-blocked, or its access token is missing or spent.`
        : `${who} refused this device. The stream is blocked for this region or its access token is spent.`;
    case 'network-lost-mid-stream':
      return `The connection dropped while ${who} was playing.`;
    case 'unknown':
      return parts.probe?.observation === 'tls-handshake-failed'
        ? `The secure connection to ${who} failed its handshake. Its certificate or TLS setup is broken.`
        : parts.probeSucceeded
          ? `${who} answers an ordinary request (HTTP ${parts.status ?? 200}), so the native player failure does not match an HTTP failure; the player/stream mismatch is unresolved.`
          : parts.probe?.observation === 'answered'
            ? `${who} answers an ordinary request, so this is the stream failing, not the connection.`
            : `This channel stopped with an error the app cannot name yet. The code below is what makes it reportable.`;
  }
};

/**
 * The one entry point: what the player said, what we handed it, and — only when the retry path
 * looked — what the host actually does when asked politely.
 */
export const classifyPlaybackFailure = (
  input: PlaybackFailureInput,
): PlaybackFailure => {
  const host = hostOf(input.url);
  const probe = input.probe ?? null;
  const payload = input.payload ?? {};
  const diagnostics = playbackErrorDiagnostics(payload);

  const codeName = nameFromErrorString(payload.error?.errorString);
  const code = codeName
    ? MEDIA3_CODE_BY_NAME[codeName] ?? null
    : media3CodeFromPayload(payload);
  const resolvedName = codeName ?? (code === null ? null : nameFromCode(code));
  const media3Name = resolvedName && /^ERROR_CODE_/.test(resolvedName) ? resolvedName : null;

  let category: PlaybackFailureCategory | null = media3Name
    ? CATEGORY_BY_CODE_NAME[media3Name] ?? null
    : null;

  // Two codes need more than their own name to be honest about.
  if (media3Name === 'ERROR_CODE_IO_UNSPECIFIED') {
    // media3's catch-all IOException. Before playback it means "would not open"; under a running
    // player it means "the socket went away", which is a different user story and a different
    // answer to "would retrying help".
    category = input.playbackStarted ? 'network-lost-mid-stream' : 'unknown';
  }
  // The status decides these. Prefer the direct GET's status; a status named in the native
  // exception is a safe fallback when the retry path has not run yet. Calling every HTTP failure a
  // broken feed — especially after a successful 200 GET — is the bug being fixed here.
  const probeStatus =
    typeof probe?.status === 'number' && Number.isInteger(probe.status) && probe.status >= 100 && probe.status <= 599
      ? probe.status
      : null;
  const httpStatus = probeStatus ?? diagnostics.httpStatus;
  if (media3Name === 'ERROR_CODE_IO_BAD_HTTP_STATUS') {
    category = httpStatus === null ? 'http-error' : categoryFromHttpStatus(httpStatus);
  }
  if (media3Name === 'ERROR_CODE_IO_FILE_NOT_FOUND') {
    // media3 reached this through a file-not-found path, so the player itself named the condition
    // and no probe is needed to say so.
    category = httpStatus === null ? 'stream-gone' : categoryFromHttpStatus(httpStatus);
  }

  if (category === null) {
    // No usable player code. The probe alone can still carry a diagnosis, because it observed the
    // transport directly. A successful 2xx answer remains `unknown`: it is evidence of a player /
    // resource mismatch, not an HTTP failure.
    if (probe?.observation === 'host-did-not-resolve' || probe?.observation === 'socket-could-not-open') {
      category = 'dns-or-unreachable';
    } else if (probe?.observation === 'timed-out') {
      category = 'connection-timeout';
    } else if (probe?.observation === 'tls-handshake-failed') {
      // No bucket says "TLS"; the handshake failing is a refusal by the endpoint, and `unknown`
      // with the honest sentence is used rather than stretching a category.
      category = 'unknown';
    } else if (probe?.observation === 'answered' && httpStatus !== null && httpStatus >= 400) {
      category = categoryFromHttpStatus(httpStatus);
    } else {
      category = 'unknown';
    }
  }

  const probeSucceeded =
    probe?.observation === 'answered' && httpStatus !== null && httpStatus >= 200 && httpStatus <= 299;
  const resourceKind = probe
    ? probe.resourceKind ??
      resourceKindFromProbe({
        url: probe.finalUrl,
        contentType: probe.contentType,
        bodyPreview: probe.bodyPreview,
      })
    : null;
  return {
    category,
    message: sentence(category, {
      host,
      status: httpStatus,
      contentType: probe?.contentType ?? null,
      probe,
      media3Name,
      probeSucceeded,
    }),
    transient: TRANSIENT_CATEGORIES.has(category),
    codeName: media3Name,
    code,
    host,
    status: httpStatus,
    nativeException: diagnostics.nativeException,
    finalUrl: probe?.finalUrl ?? null,
    contentType: probe?.contentType ?? null,
    bodyPreview: probe?.bodyPreview ?? null,
    bodyPreviewTruncated: probe?.bodyPreviewTruncated ?? false,
    resourceKind,
    probeSucceeded,
    probeMismatch: probeSucceeded && diagnostics.detail !== null,
    // Only a throttle asks for a wait by name. Everything else keeps the schedule's own cadence,
    // which is a wait the app chose rather than one it invented from a server's silence.
    backoffMs: category === 'rate-limited' ? clampBackoffMs(probe?.retryAfterSeconds) : null,
  };
};

/**
 * How many times the screen may retry a transient failure on its own before it asks the user.
 *
 * Two, not five, because this counter sits on top of one that already ran: ExoPlayer is built with
 * `DefaultLoadErrorHandlingPolicy(source.minLoadRetryCount)` (ReactExoplayerView.java:1158-1159)
 * and `Source.minLoadRetryCount` defaults to 3 (common/api/Source.kt:57), so the player has already
 * re-issued the failing load up to three times with back-off before `onError` ever reaches JS. An
 * app-side loop of the same size would be a dozen attempts on a host that is simply gone.
 */
export const MAX_AUTOMATIC_LIVE_RETRIES = 2;

/** Increasing, short, and bounded: the user is watching a spinner, not a queue. */
const AUTOMATIC_RETRY_DELAYS_MS: readonly number[] = [900, 1800];

export const automaticRetryDelayMs = (attempt: number): number =>
  AUTOMATIC_RETRY_DELAYS_MS[
    Math.min(Math.max(attempt, 1), AUTOMATIC_RETRY_DELAYS_MS.length) - 1
  ] ?? AUTOMATIC_RETRY_DELAYS_MS[AUTOMATIC_RETRY_DELAYS_MS.length - 1];

/** "Retrying (1 of 2)…" — the count the owner asked for, not a bare spinner. */
export const automaticRetryNotice = (attempt: number): string =>
  `Retrying (${Math.min(attempt, MAX_AUTOMATIC_LIVE_RETRIES)} of ${MAX_AUTOMATIC_LIVE_RETRIES})…`;

/**
 * Pure decision: may this failure be retried automatically, given how many automatic retries this
 * tune has already spent? Only a transient category can ever be retried, and the count is capped,
 * so the loop terminates by construction.
 */
export const shouldRetry = (
  failure: PlaybackFailure,
  usedAutomaticRetries: number,
  max: number = MAX_AUTOMATIC_LIVE_RETRIES,
): boolean => failure.transient && usedAutomaticRetries < max;

/**
 * How long to actually wait before attempt `attempt`. A server that named a wait (429 with
 * `Retry-After`) is obeyed within the bounds above; everything else follows the schedule.
 *
 * The wait is never longer than the retry cap allows: two attempts is two waits, so the most this
 * screen can spend waiting is twice `MAX_RETRY_BACKOFF_MS`, and a channel that needs more than that
 * is a channel the user should be told about rather than one the app sits on.
 */
export const retryDelayMsFor = (failure: PlaybackFailure, attempt: number): number =>
  failure.backoffMs ?? automaticRetryDelayMs(attempt);
