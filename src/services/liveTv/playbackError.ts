/**
 * The live player knew why a channel failed and threw the answer away: `onError` ignored its
 * payload and set one fixed sentence, so a stream the publisher took down, a host that
 * rejects the app's request, and a container the device cannot read all looked identical to
 * the user and to any report.
 *
 * Android fills the payload in `ReactExoplayerView.java:1994`: `errorString` is
 * `ExoPlaybackException: <NAME>` (so the layer that broke — IO, format, decoder — is already
 * in the string) and `errorCode` is the numeric ExoPlayer code with a `2` prefix. iOS reports
 * through `localizedDescription`/`code` instead.
 */
export type PlayerErrorPayload = Readonly<{
  error?: Readonly<{
    errorString?: string;
    errorCode?: string;
    /** Android's native exception text. It can contain the signed media URL. */
    errorException?: unknown;
    /** Android's full stack, which is where Media3 keeps the nested HTTP exception. */
    errorStackTrace?: unknown;
    localizedDescription?: string;
    code?: number;
  }>;
  /** React Native's converted native exception, when the event includes it. */
  cause?: unknown;
}>;

/** Keep native diagnostics useful without allowing a URL, token, or stack trace to escape. */
export const MAX_NATIVE_EXCEPTION_LENGTH = 512;

export interface PlaybackErrorDiagnostics {
  /** The existing short player detail, safe to put beside a failure report. */
  detail: string | null;
  /** Sanitized native exception text, when the platform supplied one. */
  nativeException: string | null;
  /** An HTTP status named by the native error, when it can be parsed without guessing. */
  httpStatus: number | null;
}

const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === null || value === undefined) return '';
  try {
    return String(value);
  } catch {
    return 'unprintable error';
  }
};

/** Read only the useful text fields from React Native's nested native-error object. */
const diagnosticText = (value: unknown, depth = 0): string => {
  if (depth > 3 || value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (Array.isArray(value)) {
    return value.map((item) => diagnosticText(item, depth + 1)).filter(Boolean).join(' ');
  }
  if (typeof value !== 'object') return asText(value);
  const record = value as Record<string, unknown>;
  return ['name', 'message', 'stack', 'errorStackTrace', 'cause']
    .map((key) => diagnosticText(record[key], depth + 1))
    .filter(Boolean)
    .join(' ');
};

const nativeDiagnosticText = (payload: PlayerErrorPayload): string => {
  const err = payload.error;
  return [
    diagnosticText(err?.errorStackTrace),
    diagnosticText(err?.errorException),
    diagnosticText(payload.cause),
    diagnosticText(err?.localizedDescription),
  ]
    .filter(Boolean)
    .join(' ');
};

/**
 * Redacts diagnostic text before it is retained or shown. Native player errors commonly include
 * the complete playlist URL, and IPTV URLs frequently carry credentials in either the query or
 * path. The output is intentionally bounded as well: a stack trace is evidence, not a log sink.
 */
export const redactDiagnosticText = (
  value: unknown,
  maxLength: number = MAX_NATIVE_EXCEPTION_LENGTH,
): string | null => {
  const raw = asText(value);
  if (!raw.trim()) return null;

  let safe = raw
    // Replace the complete URL first. This covers query tokens and credentials in the path.
    .replace(/\b(?:https?|rtsp|file):\/\/[^\s"'<>]+|\bdata:[^\s"'<>]+/gi, '<stream-url>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\-/]+=*/gi, 'Bearer <redacted>')
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie|token|access[_-]?token|api[_-]?key|password|secret|signature)\s*[:=]\s*[^\s,;]+/gi,
      (match) => `${match.slice(0, match.search(/[:=]/))}=<redacted>`,
    )
    // JWT-like values can be logged without an obvious label.
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '<redacted-token>')
    // Keep reports one line and remove control characters that could spoof report formatting.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!safe) return null;
  const limit = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : MAX_NATIVE_EXCEPTION_LENGTH;
  return safe.slice(0, limit);
};

/**
 * Reads a three-digit HTTP status only when the surrounding text labels it as an HTTP/status
 * value. This deliberately does not inspect arbitrary three-digit numbers: media3's `22004` and
 * many native errno/code values are not HTTP statuses.
 */
export const httpStatusFromText = (value: unknown): number | null => {
  const text = diagnosticText(value);
  if (!text) return null;
  const labelled = [
    /\bHTTP(?:\/\d(?:\.\d)?)?\s*(?:ERROR|STATUS|CODE)?\s*[:=]?\s*([1-5]\d{2})\b/i,
    /\b(?:STATUS|STATUS\s+CODE|RESPONSE(?:\s+CODE)?)\s*[:=]?\s*([1-5]\d{2})\b/i,
  ];
  for (const pattern of labelled) {
    const match = pattern.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
};

const stripUrlPunctuation = (value: string): string => value.replace(/[),.;\]}]+$/g, '');

/**
 * Extract the resource Media3 named in its nested exception, for an internal diagnostic retry.
 * The raw URL is returned only to the caller that immediately probes it; it is never included in a
 * `PlaybackFailure`, log line, or rendered string. The fallback to the original stream URL lives
 * in `LivePlayerScreen` when Media3 did not expose one.
 */
export const playbackErrorResourceUrl = (
  payload: PlayerErrorPayload,
): string | null => {
  const text = nativeDiagnosticText(payload);
  const urls = [...text.matchAll(/\bhttps?:\/\/[^\s"'<>]+/gi)]
    .map((match) => stripUrlPunctuation(match[0]))
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    });
  if (!urls.length) return null;
  return (
    urls.find((url) =>
      /\.(?:m3u8?|mpd|ts|m4s|mp4|aac|ac3|ec3|key|bin)(?:[?#]|$)|(?:segment|playlist|manifest|key)/i.test(
        url,
      ),
    ) ?? urls[urls.length - 1]
  );
};

/** Captures the player payload's reportable pieces without retaining its raw exception. */
export const playbackErrorDiagnostics = (
  payload: PlayerErrorPayload,
): PlaybackErrorDiagnostics => {
  const err = payload.error;
  const nativeException = redactDiagnosticText(
    diagnosticText(err?.errorStackTrace) ||
      diagnosticText(err?.errorException) ||
      diagnosticText(payload.cause),
  );
  const httpStatus = httpStatusFromText(
    [nativeDiagnosticText(payload), diagnosticText(err?.errorString)].filter(Boolean).join(' '),
  );
  return {
    detail: livePlaybackDetail(payload),
    nativeException,
    httpStatus,
  };
};

export const livePlaybackDetail = (payload: PlayerErrorPayload): string | null => {
  const err = payload.error;
  if (!err) return null;
  // Keep the short player name/code separate from the native exception. The latter is captured by
  // `playbackErrorDiagnostics` only after redaction and length bounding.
  const name = redactDiagnosticText(err.errorString ?? err.localizedDescription, 180) ?? '';
  const rawCode = err.errorCode ?? (err.code === undefined ? '' : String(err.code));
  const code = /^-?\d{1,6}$/.test(String(rawCode)) ? String(rawCode) : '';
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  return code ? `code ${code}` : null;
};
