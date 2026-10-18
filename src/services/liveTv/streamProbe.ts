/**
 * A short, bounded GET to the stream URL, used only on the retry path, to find out what the
 * resource actually does when the app asks — after the player already failed.
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
 * The requested URL is never put into the result. The response's final URL is retained only as a
 * redacted origin plus a redacted path marker: a resolved live-stream URL can carry an access token
 * in either its path or query, and this object is stored on screen state and shown to whoever
 * reports a fault.
 */

import { redactDiagnosticText } from '@/src/services/liveTv/playbackError';

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
  /**
   * The caller cancelled — the user changed channel or left the player. Not a finding about the
   * stream: it is the app stopping asking. Kept distinct so a cancelled probe can never be read as
   * evidence, and so the screen does not show a diagnosis nobody waited for.
   */
  | 'cancelled'
  /** Something thrown that identifies no layer. Reported as what it is: not observed. */
  | 'not-observed';

export type StreamResourceKind =
  | 'manifest'
  | 'media-playlist'
  | 'segment'
  | 'encryption-key'
  | 'other';

export interface StreamProbeResult {
  observation: StreamProbeObservation;
  /** Lowercased hostname, or '' when the URL could not be parsed. Safe to show. */
  host: string;
  /** Wall-clock milliseconds the probe took, including the part that timed out. */
  ms: number;
  /** Only present when the response exposed a parseable three-digit HTTP status. */
  status?: number;
  /** Content-Type header as the server sent it, lowercased. Null when absent. */
  contentType?: string | null;
  /**
   * `Retry-After` on a 429 or 503, in whole seconds, when the server actually sent a number.
   * Read as metadata only — it is never used to decide anything on its own, and the caller
   * clamps it before using it as a wait.
   */
  retryAfterSeconds?: number | null;
  /** The probe always uses GET so it exercises the same request shape as the player. */
  method: 'HEAD' | 'GET';
  /** The observed failure text with the URL scrubbed out. Diagnostics, never shown as-is. */
  detail: string;
  /** Response URL after redirects, with query, credentials, and path redacted. */
  finalUrl?: string | null;
  /** A bounded, one-line, redacted response preview. */
  bodyPreview?: string | null;
  /** Whether the response had more body data than the preview limit. */
  bodyPreviewTruncated?: boolean;
  /** Best-effort classification from response URL, Content-Type, and body preview. */
  resourceKind?: StreamResourceKind;
}

/**
 * A bounded deadline for the retry-path GET. Long enough for a distant CDN to answer, short enough
 * that the retry the user pressed is not replaced by a second wait.
 */
export const STREAM_PROBE_TIMEOUT_MS = 2500;
export const STREAM_PROBE_BODY_PREVIEW_MAX_CHARS = 512;

type ProbeResponseLike = Readonly<{
  status: number | string;
  /** Fetch's response URL is the final URL after redirects when the platform exposes it. */
  url?: string | null;
  headers?: { get: (name: string) => string | null } | null;
  body?: {
    cancel?: () => unknown;
    getReader?: () => {
      read: () => Promise<{ done?: boolean; value?: unknown }>;
      cancel?: () => unknown;
    };
  } | null;
  text?: () => Promise<string>;
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
  return redactDiagnosticText(out, 180) ?? '';
};

const parseStatus = (value: unknown): number | undefined => {
  const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
};

/** A safe representation of a response URL: the host survives, signed path/query data does not. */
export const redactFinalUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}/<redacted>`;
  } catch {
    return null;
  }
};

const rawPathOf = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  try {
    return new URL(value).pathname.toLowerCase();
  } catch {
    return value.split(/[?#]/, 1)[0]?.toLowerCase() ?? '';
  }
};

const lowerContentType = (value: string | null | undefined): string =>
  (value ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';

const looksLikeHls = (body: string): boolean => /#EXTM3U\b/i.test(body);

/**
 * Best-effort resource classification. It intentionally returns `other` for an HTML/error body
 * even when the URL still ends in `.m3u8`: the bytes the player receives are stronger evidence than
 * the catalogue filename.
 */
export const resourceKindFromProbe = (input: {
  url?: string | null;
  contentType?: string | null;
  bodyPreview?: string | null;
}): StreamResourceKind => {
  const path = rawPathOf(input.url);
  const contentType = lowerContentType(input.contentType);
  const body = input.bodyPreview ?? '';
  const hasBody = body.trim().length > 0;

  if (
    /(?:^|[/._-])(?:key|encryption-key)(?:[._-]|$)/i.test(path) ||
    /application\/(?:octet-stream|pkcs8|x-pem-file)/i.test(contentType) && /(?:^|[/_-])key(?:[/_.-]|$)/i.test(path)
  ) {
    return 'encryption-key';
  }

  if (
    /\.(?:ts|m4s|mp4|m4v|aac|ac3|ec3|mp3|webm|mov)(?:$|\?)/i.test(path) ||
    /^(?:video|audio)\//i.test(contentType) ||
    contentType === 'application/mp4' ||
    contentType === 'video/mp2t'
  ) {
    return 'segment';
  }

  const isManifestType = contentType.includes('dash+xml');
  const isPlaylistType = contentType.includes('mpegurl') || contentType.includes('m3u');
  const isDashBody = /<\s*MPD\b/i.test(body);
  const isDashPath = /\.mpd$/i.test(path);
  if (
    hasBody &&
    /<\s*(?:!doctype|html|body)\b/i.test(body) &&
    (isPlaylistType || /\.m3u8?$/i.test(path))
  ) {
    return 'other';
  }
  if (isDashBody) return 'manifest';
  if (isManifestType || isDashPath) {
    // A text/html response at a manifest URL is usually a captive portal or an origin error. The
    // URL is still useful evidence, but the bytes are stronger evidence of what the player got.
    return hasBody && /<\s*(?:!doctype|html|body)\b/i.test(body) ? 'other' : 'manifest';
  }

  if (looksLikeHls(body)) {
    if (/#EXT-X-(?:STREAM-INF|MEDIA)\b/i.test(body)) return 'manifest';
    if (/#EXT(?:INF|X-TARGETDURATION|X-MEDIA-SEQUENCE)\b/i.test(body)) {
      return 'media-playlist';
    }
    return 'manifest';
  }

  // A playlist Content-Type without a readable playlist body is an ambiguous/malformed answer,
  // not proof that the URL is a manifest. This is what keeps a 200 HTML captive-portal response
  // from being reported as a valid stream.
  if (isPlaylistType && !hasBody) return 'manifest';
  if (isPlaylistType && /(?:text\/html|application\/json)/i.test(contentType)) return 'other';
  if (isPlaylistType || /\.m3u8?$/i.test(path)) return 'manifest';
  return 'other';
};

/** Alias with an imperative name for callers that classify a response before storing it. */
export const classifyResourceKind = resourceKindFromProbe;

type BodyPreview = Readonly<{
  text: string | null;
  truncated: boolean;
  /**
   * The same bytes before redaction, kept off every result. A diagnostic field has to lose
   * its URLs; the chain walk below needs the child URI the playlist actually named, so it is
   * handed to one caller as a local and never stored, logged, or returned.
   */
  raw: string | null;
}>;

const decodeChunk = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder().decode(value);
    } catch {
      return String.fromCharCode(...value);
    }
  }
  return value === undefined || value === null ? '' : String(value);
};

/** Reads at most the preview budget and asks the stream to stop as soon as that budget is met. */
const readBodyPreview = async (
  response: ProbeResponseLike,
  maxChars: number,
): Promise<BodyPreview> => {
  const reader = response.body?.getReader?.();
  if (reader) {
    let raw = '';
    let truncated = false;
    try {
      while (raw.length < maxChars) {
        const next = await reader.read();
        if (next.done) break;
        raw += decodeChunk(next.value);
        if (raw.length >= maxChars) {
          truncated = true;
          break;
        }
      }
    } finally {
      try {
        await reader.cancel?.();
      } catch {
        // The response is still aborted by the caller after the preview attempt.
      }
    }
    return { text: raw ? redactDiagnosticText(raw, maxChars) : null, truncated, raw: raw || null };
  }

  if (response.text) {
    try {
      const raw = await response.text();
      const text = String(raw);
      return {
        text: text ? redactDiagnosticText(text, maxChars) : null,
        truncated: text.length > maxChars,
        raw: text ? text.slice(0, maxChars) : null,
      };
    } catch {
      return { text: null, truncated: false, raw: null };
    }
  }
  return { text: null, truncated: false, raw: null };
};

const headerValue = (res: ProbeResponseLike, name: string): string | null => {
  try {
    return res.headers?.get?.(name.toLowerCase()) ?? res.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
};

/**
 * A `Retry-After` value in whole seconds, or null when the header is absent or is not a number.
 *
 * This is metadata, not a decision. A server is allowed to ask for an hour, and obeying that
 * literally would strand the user on an error screen for an hour, so the classifier reads this and
 * clamps it before anything waits on it. An HTTP-date is legal here too; no host in these
 * catalogues sends one, and guessing at a date against a device clock the app has not verified is
 * reported as "no number" instead.
 */
export const retryAfterSecondsOf = (raw: string | null | undefined): number | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  return Number.isFinite(seconds) ? seconds : null;
};

export interface ProbeOptions {
  timeoutMs?: number;
  /** The stream's own headers; several IPTV CDNs 403 a bare request. */
  headers?: Record<string, string>;
  fetchImpl?: ProbeFetch;
  /** Injectable for tests; defaults to the real clock. */
  now?: () => number;
  /**
   * The caller's cancellation. When this aborts, the probe reports `cancelled` rather than
   * `timed-out`: "the user left the channel" is not evidence about the stream, and must not be
   * stored as if it were a measurement.
   */
  signal?: AbortSignal;
  /**
   * Handed the unredacted response body, for the one caller that has to read a child URI out of a
   * playlist. Redaction turns every URL into `<stream-url>`, which is correct for a diagnostic
   * field and useless as a request target. Nothing may store this value on a result, log it, or
   * return it: it exists so `probeStreamChain` can hold it in a local for one more request.
   */
  onRawBody?: (raw: string) => void;
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
      method: 'GET',
      detail: 'no fetch implementation available',
    };
  }

  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  // The caller's cancellation is folded into the same controller, so one abort path ends the
  // request whatever caused it. `callerCancelled` is tracked separately because the *reason* has
  // to survive into the result: a user who left the channel is not a measurement of the stream.
  const external = options.signal ?? null;
  let callerCancelled = external?.aborted === true;
  if (external && !callerCancelled) {
    try {
      external.addEventListener('abort', onCallerAbort, { once: true });
    } catch {
      // An implementation without addEventListener cannot cancel; the deadline still bounds it.
    }
  }
  function onCallerAbort(): void {
    callerCancelled = true;
    try {
      controller.abort();
    } catch {
      // Already ended by the abort itself.
    }
  }
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      controller.abort();
    } catch {
      // An abort that fails changes nothing: the deadline already passed.
    }
  }, timeoutMs);

  const request = async (): Promise<StreamProbeResult> => {
    const res = await fetchImpl(url, {
      method: 'GET',
      // Do not add a Range header here: signed CDNs and origin ACLs may treat it differently from
      // the Media3 request. The body reader below cancels after the diagnostic budget instead.
      headers: options.headers ?? {},
      signal: controller.signal,
      cache: 'no-store',
    });
    const status = parseStatus(res.status);
    const contentType = headerValue(res, 'content-type')?.toLowerCase() ?? null;
    let preview: BodyPreview = { text: null, truncated: false, raw: null };
    // A Response can expose headers before a body that never completes. Race the body read against
    // the same deadline so the retry path remains bounded even when a test/native implementation
    // does not reject its reader on AbortController.abort().
    const remaining = Math.max(0, deadline - now());
    if (remaining > 0 && (res.body?.getReader || res.text)) {
      const bodyRead = readBodyPreview(res, STREAM_PROBE_BODY_PREVIEW_MAX_CHARS);
      let bodyTimer: ReturnType<typeof setTimeout> | null = null;
      try {
        preview = await Promise.race([
          bodyRead,
          new Promise<BodyPreview>((resolve) => {
            bodyTimer = setTimeout(
              () => resolve({ text: null, truncated: false, raw: null }),
              remaining,
            );
          }),
        ]);
      } finally {
        if (bodyTimer !== null) clearTimeout(bodyTimer);
        void bodyRead.catch(() => undefined);
      }
    }
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

    const rawFinalUrl = typeof res.url === 'string' && res.url ? res.url : url;
    const finalUrl = redactFinalUrl(rawFinalUrl);
    const result: StreamProbeResult = {
      observation: 'answered',
      host,
      ms: Math.max(0, now() - startedAt),
      ...(status === undefined ? {} : { status }),
      contentType,
      retryAfterSeconds: retryAfterSecondsOf(headerValue(res, 'retry-after')),
      method: 'GET',
      detail: status === undefined ? 'HTTP status unavailable' : `HTTP ${status}`,
      finalUrl,
      bodyPreview: preview.text,
      bodyPreviewTruncated: preview.truncated,
      resourceKind: resourceKindFromProbe({
        url: rawFinalUrl,
        contentType,
        bodyPreview: preview.text,
      }),
    };
    if (preview.raw) {
      try {
        options.onRawBody?.(preview.raw);
      } catch {
        // A caller that cannot handle the body it asked for still gets the ordinary result.
      }
    }
    return result;
  };

  const cancelledResult = (): StreamProbeResult => ({
    observation: 'cancelled',
    host,
    ms: Math.max(0, now() - startedAt),
    method: 'GET',
    detail: 'cancelled before an answer was observed',
  });

  if (callerCancelled) {
    clearTimeout(timer);
    return cancelledResult();
  }

  try {
    return await request();
  } catch (err) {
    if (callerCancelled) {
      return cancelledResult();
    }
    if (timedOut) {
      return {
        observation: 'timed-out',
        host,
        ms: Math.max(0, now() - startedAt),
        method: 'GET',
        detail: `no answer within ${timeoutMs}ms`,
      };
    }
    const text = textOf(err);
    return {
      observation: observationFromErrorText(text),
      host,
      ms: Math.max(0, now() - startedAt),
      method: 'GET',
      detail: scrub(text, url) || 'network request failed',
    };
  } finally {
    clearTimeout(timer);
    if (external) {
      try {
        external.removeEventListener('abort', onCallerAbort);
      } catch {
        // Nothing to detach on an implementation that never attached it.
      }
    }
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

// ── The one level below the address the catalogue published ────────────────

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Resolve a playlist reference against the parent URL the player was handed. */
export const resolvePlaylistChild = (parentUrl: string, reference: string): string | null => {
  const ref = reference.trim();
  // A query-bearing token is normal here: signed HLS segment URLs are the common case. What must
  // never happen is the *result* being logged — probe results carry only a redacted final URL.
  if (!ref || ref.startsWith('#') || ref.startsWith('data:')) return null;
  try {
    return HAS_SCHEME.test(ref) ? ref : new URL(ref, parentUrl).toString();
  } catch {
    return null;
  }
};

/**
 * Split a playlist body into records.
 *
 * The probe preview is deliberately one line — it collapses newlines to keep a 512-character
 * budget useful — so splitting on `\n` alone would read a whole master playlist as a single tag and
 * find nothing in it. When no newline survives, the records are split back apart at the `#EXT`
 * boundary every HLS tag starts with.
 */
const playlistRecords = (body: string): string[] => {
  const text = body.replace(/\r\n?/g, '\n');
  const parts = text.includes('\n') ? text.split('\n') : text.split(/(?=#EXT)/i);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
};

/**
 * The URI a record carries after its attributes, or '' when the URI is a record of its own.
 *
 * `CODECS="avc1.640028, mp4a.40.2"` contains a space inside quotes, which is why the attributes are
 * cut at the last closing quote when there is one rather than at the first space.
 */
const uriAfterTag = (record: string): string => {
  if (!record.startsWith('#')) return record;
  const lastQuote = record.lastIndexOf('"');
  if (lastQuote > 0) return record.slice(lastQuote + 1).trim();
  return record.replace(/^#EXT\S*/i, '').trim();
};

/**
 * The first thing a player asks for *after* the address in the channel list.
 *
 * Order matters, because it is the order media3 issues them: an `#EXT-X-KEY` URI is fetched before
 * any media and a refused key stops playback on its own; the variant line under `#EXT-X-STREAM-INF`
 * is next for a master playlist; a bare URI is a segment. Returning the first of those the body
 * actually contains is what lets a `200` on the top-level address be reported for what it is —
 * evidence about one request, not about the stream.
 *
 * The body is a 512-character preview, so a long master may not contain the child. Absent evidence
 * the walk stops and says nothing, which is the correct answer.
 */
export const firstPlaylistChildOf = (
  body: string | null | undefined,
  parentUrl: string,
): { url: string; kind: StreamResourceKind } | null => {
  if (!body) return null;
  const records = playlistRecords(body);

  for (const record of records) {
    const quoted = /#EXT-X-KEY:[^\n]*URI="([^"]+)"/i.exec(record)?.[1];
    if (quoted) {
      const url = resolvePlaylistChild(parentUrl, quoted);
      if (url) return { url, kind: 'encryption-key' };
    }
  }

  for (let i = 0; i < records.length; i += 1) {
    if (!/#EXT-X-STREAM-INF\b/i.test(records[i])) continue;
    const reference = uriAfterTag(records[i]) || records[i + 1] || '';
    const url = resolvePlaylistChild(parentUrl, reference);
    if (url) return { url, kind: 'media-playlist' };
  }

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.startsWith('#')) {
      // Only `#EXTINF` puts its own media on the same record; anything else that follows a tag is
      // an attribute of that tag, not a resource to fetch.
      const trailing = uriAfterTag(record);
      if (!trailing || !/#EXTINF\b/i.test(record)) continue;
      const url = resolvePlaylistChild(parentUrl, trailing);
      if (url) return { url, kind: 'segment' };
      continue;
    }
    const url = resolvePlaylistChild(parentUrl, record);
    if (url) return { url, kind: 'segment' };
  }

  return null;
};

export interface StreamProbeChain {
  /** The address the catalogue published — the one the player was handed. */
  top: StreamProbeResult;
  /** The first request the player makes after that, when the top answer named one. */
  child: StreamProbeResult | null;
  childKind: StreamResourceKind | null;
}

/**
 * Ask the host twice, at most: the published address, then the first resource that address points
 * at. Bounded by design — this runs on the error path of a single playback attempt, on a phone,
 * against a CDN that may be doing the refusing.
 */
export const probeStreamChain = async (
  url: string | null | undefined,
  options: ProbeOptions = {},
): Promise<StreamProbeChain | null> => {
  let rawTop: string | null = null;
  const top = await probeStream(url, {
    ...options,
    onRawBody: (raw): void => {
      rawTop = raw;
    },
  });
  if (!top) return null;

  const status = top.status ?? 0;
  const answeredWell = top.observation === 'answered' && status >= 200 && status <= 299;
  const namesAChild = top.resourceKind === 'manifest' || top.resourceKind === 'media-playlist';
  if (!answeredWell || !namesAChild || !top.bodyPreview) {
    return { top, child: null, childKind: null };
  }
  // The user may have left the channel while the first request was in flight. A second request
  // after that is a leak, not a diagnosis.
  if (options.signal?.aborted) return { top, child: null, childKind: null };

  // The unredacted body when we captured one: a redacted playlist has every URL replaced by
  // `<stream-url>`, which reads as a real relative reference and would send the second request
  // somewhere invented. The redacted preview is the fallback, and only useful when the child was a
  // bare relative name.
  const child = firstPlaylistChildOf(rawTop ?? top.bodyPreview, url ?? '');
  if (!child) return { top, child: null, childKind: null };

  const { onRawBody, ...childOptions } = options;
  return { top, child: await probeStream(child.url, childOptions), childKind: child.kind };
};
