/**
 * A short, bounded request to the stream URL, used only on the retry path, to find out what the
 * host actually does when the app asks — after the player already failed.
 *
 * What this can honestly name, and what it cannot:
 *  - Any HTTP response at all, on any status, proves name resolution, TCP and TLS all worked. That
 *    is why `answered` is its own observation: it is the only conclusion this probe reaches with
 *    certainty, and it is the one that separates "the publisher's server is dead" from "the
 *    publisher's server says no".
 *  - React Native's `fetch` does NOT hand back the transport layer. On Android every failure below
 *    the HTTP layer — DNS, refused socket, reset, unreachable network — is folded into
 *    `TypeError: Network request failed`, so on a release build most failures land in
 *    `not-observed`. When the platform does pass the underlying text through (OkHttp's
 *    `UnknownHostException: Unable to resolve host ...`, iOS's
 *    `NSURLErrorDomain ... -1003 / cannot find host`), the markers below name it.
 *  - Therefore: `host-did-not-resolve` is only ever returned when a DNS-specific string was
 *    actually observed. A failure that only says "could not connect" is reported as
 *    `socket-could-not-open`, never as DNS. Same discipline as `TMDBService.request` and
 *    `homeFeedFetch`, which name the host they measured instead of blaming the user's Wi-Fi.
 *
 * The URL is never put into the result: a resolved live-stream URL can carry an access token in its
 * path or query, and this object is stored on screen state and shown to whoever reports a fault.
 */

export type StreamProbeObservation =
  /** The host answered with an HTTP status. DNS, TCP and TLS all worked. */
  | 'answered'
  /** A DNS-specific failure string was observed. Only set on evidence, never inferred. */
  | 'host-did-not-resolve'
  /** The platform said the socket could not be opened, without naming why. */
  | 'socket-could-not-open'
  /** The secure connection itself failed: certificate, hostname or handshake. */
  | 'tls-handshake-failed'
  /** Our own deadline passed with no answer. Weak on its own: a distant CDN can be slow and fine. */
  | 'timed-out'
  /** Something thrown that identifies no layer. Reported as what it is: not observed. */
  | 'not-observed';

export interface StreamProbeResult {
  observation: StreamProbeObservation;
  /** Lowercased hostname, or '' when the URL could not be parsed. Safe to show. */
  host: string;
  /** Wall-clock milliseconds the probe took, including the part that timed out. */
  ms: number;
  /** Only present when `observation === 'answered'`. */
  status?: number;
  /** Content-Type header as the server sent it, lowercased. Null when absent. */
  contentType?: string | null;
  /** Which method produced the answer; HEAD is the first try, GET only when HEAD is refused. */
  method: 'HEAD' | 'GET';
  /** The observed failure text with the URL scrubbed out. Diagnostics, never shown as-is. */
  detail: string;
}

/**
 * A whole second and a half of patience, then we stop asking. Long enough for a distant CDN to
 * answer a HEAD, short enough that the retry the user pressed is not replaced by a second wait.
 */
export const STREAM_PROBE_TIMEOUT_MS = 2500;

type ProbeResponseLike = Readonly<{
  status: number;
  headers?: { get: (name: string) => string | null } | null;
  body?: { cancel?: () => unknown } | null;
}>;

export type ProbeFetch = (
  url: string,
  init: Record<string, unknown>,
) => Promise<ProbeResponseLike>;

// Each marker is a string a platform actually prints for that layer, and nothing here is a guess
// from a generic failure: `unknownhostexception` is OkHttp's class name, `-1003` is
// NSURLErrorCannotFindHost, `software caused connection abort` is OkHttp's socket death.
const DNS_MARKERS: readonly string[] = [
  'enotfound',
  'eai_noname',
  'eai_again',
  'eai_nodata',
  'unknownhostexception',
  'unable to resolve host',
  'no address associated with hostname',
  'nodename nor servname',
  'name or service not known',
  'could not find host',
  'cannot find host',
  'no such host',
  '-1003',
];

const SOCKET_MARKERS: readonly string[] = [
  'econnrefused',
  'connection refused',
  'failed to connect to',
  'unable to open socket',
  'network is unreachable',
  'enetunreach',
  'econnaborted',
  'econnreset',
  'software caused connection abort',
  'connection closed',
  'connection reset',
];

const TLS_MARKERS: readonly string[] = [
  'sslexception',
  'ssl peer unverified',
  'ssl handshake',
  'tls handshake',
  'certificate',
  'cert_path_expired',
  'trustanchor',
  'trust anchor',
  'not trusted',
  'certificateverify',
  '-1200',
  '-1202',
  '-1203',
];

const TIMEOUT_MARKERS: readonly string[] = [
  'etimedout',
  'timed out',
  'timeout',
];

const textOf = (err: unknown): string => {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.name, err.message);
    // RN and Node both put the useful native text one level down.
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) parts.push(cause.name, cause.message);
    else if (typeof cause === 'string') parts.push(cause);
  } else {
    try {
      parts.push(String(err));
    } catch {
      parts.push('unprintable error');
    }
  }
  return parts.join(' ').toLowerCase();
};

/**
 * Which layer the platform named, if any. Ordered so that a specific marker beats a generic one:
 * an OkHttp `SSLException` wrapping a `UnknownHostException` says more about DNS than about TLS.
 */
export const observationFromErrorText = (text: string): StreamProbeObservation => {
  if (TLS_MARKERS.some((m) => text.includes(m)) && !DNS_MARKERS.some((m) => text.includes(m))) {
    return 'tls-handshake-failed';
  }
  if (DNS_MARKERS.some((m) => text.includes(m))) return 'host-did-not-resolve';
  if (TIMEOUT_MARKERS.some((m) => text.includes(m))) return 'timed-out';
  if (SOCKET_MARKERS.some((m) => text.includes(m))) return 'socket-could-not-open';
  return 'not-observed';
};

/** Takes the URL out of the text a fault report would otherwise carry, token and all. */
const scrub = (text: string, url: string): string => {
  let out = text;
  if (url) out = out.split(url).join('<stream-url>');
  try {
    const parsed = new URL(url);
    out = out.split(`${parsed.host}${parsed.pathname}`).join('<stream-path>');
  } catch {
    // Nothing more to remove from a URL that never parsed.
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 180);
};

const headerValue = (res: ProbeResponseLike, name: string): string | null => {
  try {
    return res.headers?.get?.(name.toLowerCase()) ?? res.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
};

export interface ProbeOptions {
  timeoutMs?: number;
  /** The stream's own headers; several IPTV CDNs 403 a bare request. */
  headers?: Record<string, string>;
  fetchImpl?: ProbeFetch;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => number;
}

/**
 * Never throws and never blocks longer than its own deadline. Returns null only when there is no
 * URL to ask about — the caller must treat null as "we learned nothing", not as a clean bill.
 */
export const probeStream = async (
  url: string | null | undefined,
  options: ProbeOptions = {},
): Promise<StreamProbeResult | null> => {
  if (!url) return null;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? STREAM_PROBE_TIMEOUT_MS;
  const now = options.now ?? ((): number => Date.now());
  const fetchImpl: ProbeFetch | undefined =
    options.fetchImpl ?? (globalThis.fetch as unknown as ProbeFetch | undefined);
  if (!fetchImpl) {
    return {
      observation: 'not-observed',
      host,
      ms: 0,
      method: 'HEAD',
      detail: 'no fetch implementation available',
    };
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      controller.abort();
    } catch {
      // An abort that fails changes nothing: the deadline already passed.
    }
  }, timeoutMs);

  const request = async (method: 'HEAD' | 'GET'): Promise<StreamProbeResult> => {
    const res = await fetchImpl(url, {
      method,
      headers: options.headers ?? {},
      signal: controller.signal,
      cache: 'no-store',
      // RN's fetch ignores `body` for GET/HEAD; nothing else is sent.
    });
    const contentType = headerValue(res, 'content-type')?.toLowerCase() ?? null;
    // Stop the transfer without reading it: React Native's fetch has no bounded body read, so
    // pulling a multi-megabyte segment to prove a point is not an acceptable cost.
    try {
      res.body?.cancel?.();
    } catch {
      // Some implementations have no body handle; the abort below ends the request either way.
    }
    try {
      controller.abort();
    } catch {
      // Already ended.
    }
    return {
      observation: 'answered',
      host,
      ms: Math.max(0, now() - startedAt),
      status: res.status,
      contentType,
      method,
      detail: `HTTP ${res.status}`,
    };
  };

  try {
    const head = await request('HEAD');
    // Some CDNs answer HEAD with 405/501 (or 404, which is what HEAD-less origin servers do).
    // One short GET is the difference between "the feed is gone" and "this server does not do HEAD".
    if (head.status === 405 || head.status === 501 || head.status === 404) {
      const remaining = deadline - now();
      if (remaining > 150) {
        try {
          return await request('GET');
        } catch (err) {
          if (timedOut) {
            return { ...head, observation: 'timed-out', status: undefined, contentType: undefined, detail: 'GET after HEAD did not answer in time' };
          }
          return {
            ...head,
            observation: observationFromErrorText(textOf(err)),
            status: undefined,
            contentType: undefined,
            detail: scrub(textOf(err), url) || head.detail,
          };
        }
      }
    }
    return head;
  } catch (err) {
    if (timedOut) {
      return {
        observation: 'timed-out',
        host,
        ms: Math.max(0, now() - startedAt),
        method: 'HEAD',
        detail: `no answer within ${timeoutMs}ms`,
      };
    }
    const text = textOf(err);
    return {
      observation: observationFromErrorText(text),
      host,
      ms: Math.max(0, now() - startedAt),
      method: 'HEAD',
      detail: scrub(text, url) || 'network request failed',
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The container a probe's Content-Type header supports, or null when the header says nothing.
 * Callers that need a hint the probe could not supply must say so — an absent Content-Type is not
 * evidence that a stream is progressive.
 */
export const containerHintFromProbe = (
  probe: StreamProbeResult | null | undefined,
): 'm3u8' | 'mpd' | 'progressive' | null => {
  if (!probe || probe.observation !== 'answered') return null;
  // Compared case-insensitively on purpose: `probeStream` lowercases what it reads, but this
  // function is also handed results built by callers and tests, and a server is free to answer
  // `Application/VND.Apple.mPEGURL`.
  const type = (probe.contentType ?? '').toLowerCase();
  if (!type) return null;
  if (type.includes('mpegurl') || type.includes('vnd.apple.mpegurl')) return 'm3u8';
  if (type.includes('dash+xml')) return 'mpd';
  // A media MIME from the server is the strongest signal available without reading the body.
  // Captive portals and error pages answer text/html — that is not a container claim.
  if (
    type.startsWith('video/') ||
    type.startsWith('audio/') ||
    type === 'application/mp4' ||
    type === 'application/octet-stream'
  ) {
    // octet-stream is what a great many IPTV CDNs answer for HLS playlists, so it is not read as
    // progressive; only an explicit video/audio or mp4 type is.
    return type === 'application/octet-stream' ? null : 'progressive';
  }
  return null;
};
