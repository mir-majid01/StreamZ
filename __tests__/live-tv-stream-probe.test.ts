/**
 * The retry-path probe is the only place the app is allowed to look at the transport itself, so
 * these tests are mostly about restraint: what it may claim, and what it must leave unclaimed when
 * the platform says nothing. React Native's `fetch` folds DNS, refused sockets, resets and an
 * offline device into one `TypeError: Network request failed`, so a generic failure is reported as
 * `not-observed` — not as DNS, and not as "your connection".
 */
import {
  containerHintFromProbe,
  observationFromErrorText,
  probeStream,
  type ProbeFetch,
  type StreamProbeResult,
} from '@/src/services/liveTv/streamProbe';

const TOKENED_URL = 'https://cdn.example-live.invalid/real/star/idx.m3u8?token=SECRET-TOKEN';

const response = (
  status: number,
  headers: Record<string, string> = {},
): { status: number; headers: { get: (n: string) => string | null } } => {
  // Header names are case-insensitive on the wire; RN's implementation lowercases them before
  // handing them over, so the fake does the same and the test can write them as a server would.
  const normalised: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) normalised[name.toLowerCase()] = value;
  return { status, headers: { get: (name: string) => normalised[name.toLowerCase()] ?? null } };
};

const fetchAlways =
  (res: ReturnType<typeof response>): ProbeFetch => async () => res;

const recordOf = (calls: Array<Record<string, unknown>>): ProbeFetch => async (_url, init) => {
  calls.push(init);
  return response(200, { 'content-type': 'application/vnd.apple.mpegurl' });
};

const hostOf = (result: StreamProbeResult | null): string | null => result?.host ?? null;

describe('probeStream — what a reply proves', () => {
  it('reads an answer as an answer: status, content type, and the host only', async () => {
    const result = await probeStream(TOKENED_URL, {
      fetchImpl: fetchAlways(response(200, { 'Content-Type': 'Application/VND.Apple.mPEGURL' })),
    });
    expect(result?.observation).toBe('answered');
    expect(result?.status).toBe(200);
    // Lowercased here so every later comparison is one comparison.
    expect(result?.contentType).toBe('application/vnd.apple.mpegurl');
    expect(hostOf(result)).toBe('cdn.example-live.invalid');
    expect(JSON.stringify(result)).not.toContain('SECRET-TOKEN');
    expect(JSON.stringify(result)).not.toContain('/real/star');
  });

  it('treats an error status as an answer too — the host is alive and talking', async () => {
    const result = await probeStream(TOKENED_URL, { fetchImpl: fetchAlways(response(404)) });
    expect(result?.observation).toBe('answered');
    expect(result?.status).toBe(404);
  });

  it('follows a refused HEAD with one short GET, and says which method answered', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl: ProbeFetch = async (_url, init) => {
      calls.push(init);
      if (init.method === 'HEAD') return response(405);
      return response(200, { 'content-type': 'application/x-mpegURL' });
    };
    const result = await probeStream(TOKENED_URL, { fetchImpl, timeoutMs: 2000 });
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
    expect(result?.observation).toBe('answered');
    expect(result?.method).toBe('GET');
    expect(result?.contentType).toBe('application/x-mpegurl');
  });

  it('sends the stream headers, because several IPTV CDNs answer a bare request with 403', async () => {
    const calls: Array<Record<string, unknown>> = [];
    await probeStream(TOKENED_URL, {
      fetchImpl: recordOf(calls),
      headers: { Referer: 'https://example-live.invalid/', 'User-Agent': 'shield' },
    });
    expect(calls[0].headers).toEqual({
      Referer: 'https://example-live.invalid/',
      'User-Agent': 'shield',
    });
  });

  it('passes the abort signal so nothing keeps downloading after the headers', async () => {
    const calls: Array<Record<string, unknown>> = [];
    await probeStream(TOKENED_URL, { fetchImpl: recordOf(calls) });
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('probeStream — what a failure may claim', () => {
  it('reports a bare RN network failure as not observed, and never as DNS', async () => {
    const fetchImpl: ProbeFetch = async () => {
      throw new TypeError('Network request failed');
    };
    const result = await probeStream(TOKENED_URL, { fetchImpl });
    expect(result?.observation).toBe('not-observed');
    expect(result?.detail).not.toContain('SECRET-TOKEN');
    expect(result?.status).toBeUndefined();
  });

  it('names DNS only on the text that names DNS', async () => {
    const fetchImpl: ProbeFetch = async () => {
      const err = new TypeError('Network request failed');
      (err as { cause?: unknown }).cause = new Error(
        'java.net.UnknownHostException: Unable to resolve host "cdn.example-live.invalid": No address associated with hostname',
      );
      throw err;
    };
    const result = await probeStream(TOKENED_URL, { fetchImpl });
    expect(result?.observation).toBe('host-did-not-resolve');
  });

  it('names a refused socket separately from a name that will not resolve', async () => {
    const fetchImpl: ProbeFetch = async () => {
      throw new Error('Failed to connect to cdn.example-live.invalid/198.51.100.7:443');
    };
    const result = await probeStream(TOKENED_URL, { fetchImpl });
    expect(result?.observation).toBe('socket-could-not-open');
    expect(result?.detail).toContain('failed to connect');
  });

  it('names a certificate failure as TLS and not as a refusal', async () => {
    const fetchImpl: ProbeFetch = async () => {
      throw new Error('javax.net.ssl.SSLHandshakeException: Certificate not trusted for hostname');
    };
    const result = await probeStream(TOKENED_URL, { fetchImpl });
    expect(result?.observation).toBe('tls-handshake-failed');
  });

  it('classifies our own deadline as timed-out, whatever the platform then says', async () => {
    const fetchImpl: ProbeFetch = (_url, init) =>
      new Promise((_res, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const result = await probeStream(TOKENED_URL, { fetchImpl, timeoutMs: 20 });
    expect(result?.observation).toBe('timed-out');
    expect(result?.status).toBeUndefined();
    expect(result?.ms).toBeGreaterThanOrEqual(0);
  });

  it('never rejects, even when fetch throws something unprintable', async () => {
    const fetchImpl: ProbeFetch = async () => {
      throw 'not even an error object';
    };
    await expect(probeStream(TOKENED_URL, { fetchImpl })).resolves.toMatchObject({
      observation: 'not-observed',
    });
  });

  it('returns null when there is no URL to ask about', async () => {
    expect(await probeStream(null, { fetchImpl: fetchAlways(response(200)) })).toBeNull();
    expect(await probeStream('', { fetchImpl: fetchAlways(response(200)) })).toBeNull();
    expect(await probeStream('not a url', { fetchImpl: fetchAlways(response(200)) })).toBeNull();
  });
});

describe('observationFromErrorText', () => {
  it.each([
    ['java.net.UnknownHostException: Unable to resolve host', 'host-did-not-resolve'],
    ['Error Domain=NSURLErrorDomain Code=-1003 "A server with the specified hostname could not be found"', 'host-did-not-resolve'],
    ['errno=7 (socket has disconnected)', 'not-observed'],
    ['Network request failed', 'not-observed'],
    ['Connection refused', 'socket-could-not-open'],
    ['SocketTimeoutException: timeout', 'timed-out'],
    ['javax.net.ssl.SSLPeerUnverifiedException: Certificate not trusted', 'tls-handshake-failed'],
  ])('reads %j as %s', (text, observation) => {
    expect(observationFromErrorText(text.toLowerCase())).toBe(observation);
  });
});

describe('containerHintFromProbe', () => {
  const answered = (contentType: string | null): StreamProbeResult => ({
    observation: 'answered',
    host: 'cdn.example-live.invalid',
    ms: 10,
    status: 200,
    contentType,
    method: 'HEAD',
    detail: 'HTTP 200',
  });

  it.each([
    ['application/vnd.apple.mpegurl', 'm3u8'],
    ['application/x-mpegURL', 'm3u8'],
    // Servers answer this header in whatever case they like; the hint must not depend on it.
    ['Application/VND.Apple.mPEGURL', 'm3u8'],
    ['application/dash+xml', 'mpd'],
    ['video/mp2t', 'progressive'],
    ['video/mp4', 'progressive'],
  ])('reads %s as %s', (type, hint) => {
    expect(containerHintFromProbe(answered(type))).toBe(hint);
  });

  it('claims nothing about format when the header is missing or is not a media type', () => {
    // `application/octet-stream` is what a large share of IPTV CDNs answer for an HLS playlist, so
    // reading it as "progressive container" would send the player to the wrong reader.
    for (const type of [null, '', 'text/html', 'application/octet-stream']) {
      expect(containerHintFromProbe(answered(type))).toBeNull();
    }
    expect(containerHintFromProbe(answered('text/html'))).toBeNull();
  });

  it('says nothing when the probe never reached the server', () => {
    expect(
      containerHintFromProbe({
        observation: 'host-did-not-resolve',
        host: 'cdn.example-live.invalid',
        ms: 4,
        method: 'HEAD',
        detail: 'unknownhostexception',
      }),
    ).toBeNull();
    expect(containerHintFromProbe(null)).toBeNull();
  });
});
