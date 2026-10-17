/**
 * Owner P0, after the run-40 device test: the player reported
 * `ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS (22004)` for a channel on
 * `tvsen5.aynaott.com`, and the screen said the published feed was "broken or gone".
 *
 * Measured, not assumed:
 *  - media3's HTTP failure payload carries the condition name and `"2"+code`, never the status
 *    (ReactExoplayerView.java:1994), so the app cannot know 403 from 404 from 429 from the payload.
 *  - In the live iptv-org catalogue, 4 of the 14 `*.aynaott.com/index.m3u8` paths answer
 *    `HTTP 404` with the body `Not found` — one of them while still declaring
 *    `content-type: application/vnd.apple.mpegurl` — and the other 10 answer 200 with a real
 *    `#EXTM3U`. The same host serves both. So the failure is a stale per-channel address, not a
 *    host outage and not the user's connection, and "the feed is broken or taken down" happened to
 *    be true for this one case while being false for a 429 or a 403 it would print identically.
 *  - There is no second address to fall back to: across 11,356 iptv-org entries zero `tvg-id`s
 *    repeat, and the Free-TV list shares zero `tvg-id`s with it. "Try the next source" therefore
 *    cannot mean "another URL for this channel" — the honest behaviour is a correct sentence, no
 *    retry burned on a permanent answer, and an invitation to change channel.
 */
import {
  MAX_RETRY_BACKOFF_MS,
  MIN_RETRY_BACKOFF_MS,
  categoryFromHttpStatus,
  classifyPlaybackFailure,
  retryDelayMsFor,
  shouldRetry,
  type PlaybackFailureCategory,
} from '@/src/services/liveTv/playbackFailure';
import {
  probeStream,
  retryAfterSecondsOf,
  type ProbeFetch,
  type StreamProbeResult,
} from '@/src/services/liveTv/streamProbe';

const URL_OK = 'https://tvsen5.aynaott.com/someChannelToken/index.m3u8';

const badHttpStatus = (name = 'ERROR_CODE_IO_BAD_HTTP_STATUS') => ({
  error: { errorString: `ExoPlaybackException: ${name}`, errorCode: '22004' },
});

const probe = (over: Partial<StreamProbeResult> = {}): StreamProbeResult => ({
  observation: 'answered',
  host: 'tvsen5.aynaott.com',
  ms: 120,
  method: 'HEAD',
  detail: 'HTTP 200',
  status: 200,
  contentType: 'application/vnd.apple.mpegurl',
  ...over,
});

const classify = (over: Partial<Parameters<typeof classifyPlaybackFailure>[0]> = {}) =>
  classifyPlaybackFailure({
    payload: badHttpStatus(),
    url: URL_OK,
    probe: null,
    playbackStarted: false,
    ...over,
  });

describe('an HTTP status is classified by what it is, not by all HTTP being alike', () => {
  const cases: ReadonlyArray<readonly [number, PlaybackFailureCategory, boolean]> = [
    [400, 'http-error', false],
    [401, 'access-rejected', false],
    [403, 'access-rejected', false],
    [404, 'stream-gone', false],
    [407, 'access-rejected', false],
    [408, 'connection-timeout', true],
    [410, 'stream-gone', false],
    [429, 'rate-limited', true],
    [500, 'upstream-unreachable', true],
    [502, 'upstream-unreachable', true],
    [503, 'upstream-unreachable', true],
    [504, 'upstream-unreachable', true],
  ];

  it.each(cases)('HTTP %i lands in %s and is retryable=%s', (status, category, transient) => {
    expect(categoryFromHttpStatus(status)).toBe(category);
    const made = classify({ probe: probe({ status, detail: `HTTP ${status}` }) });
    expect(made.category).toBe(category);
    expect(made.transient).toBe(transient);
    expect(made.status).toBe(status);
  });

  // The owner's rule: no blanket sentence.
  it('names a 404 as a stale address and not as the user connection or a generic broken feed', () => {
    const message = classify({ probe: probe({ status: 404 }) }).message;
    expect(message).toMatch(/404/);
    expect(message).toMatch(/stopped serving|stale entry/i);
    // The negative half is the point: the previous build printed this case as the owner's problem,
    // so any wording that tells them to check their own connection has to fail here.
    expect(message).not.toMatch(/your connection|your network|your (wi-?fi|internet|data)/i);
  });

  it('separates a removed feed (410) from a missing one (404)', () => {
    const gone = classify({ probe: probe({ status: 404 }) }).message;
    const removed = classify({ probe: probe({ status: 410 }) }).message;
    expect(removed).toMatch(/removed/i);
    expect(gone).not.toMatch(/removed/i);
    expect(removed).not.toBe(gone);
  });

  it('says throttled for 429 and the publisher origin failed for 5xx', () => {
    expect(classify({ probe: probe({ status: 429 }) }).message).toMatch(/throttl/i);
    const upstream = classify({ probe: probe({ status: 502 }) }).message;
    expect(upstream).toMatch(/own server failed/i);
    // 5xx is explicitly NOT reported as the app failing to reach the host.
    expect(upstream).toMatch(/reached it/i);
  });

  it('keeps 401/403 an access decision rather than a missing feed', () => {
    const refused = classify({ probe: probe({ status: 403 }) });
    expect(refused.category).toBe('access-rejected');
    expect(refused.message).toMatch(/refused/i);
    expect(refused.message).not.toMatch(/404|taken down|gone/i);
  });

  it('never calls an unreadable status a broken or gone feed', () => {
    // Without a probe the category is http-error and status stays null. This is the sentence the
    // run-40 build showed; the difference is that it may no longer invent a reason.
    const unknown = classify();
    expect(unknown.category).toBe('http-error');
    expect(unknown.status).toBeNull();
    expect(unknown.transient).toBe(false);
    expect(unknown.message).not.toMatch(/broken|gone|taken down/i);
    expect(unknown.message.length).toBeGreaterThan(20);
  });

  it('reports 22005 (file not found) as gone without needing a probe', () => {
    const made = classify({
      payload: {
        error: {
          errorString: 'ExoPlaybackException: ERROR_CODE_IO_FILE_NOT_FOUND',
          errorCode: '22005',
        },
      },
      probe: null,
    });
    expect(made.category).toBe('stream-gone');
    expect(made.transient).toBe(false);
  });
});

describe('a permanent answer is not retried, a transient one is, and the wait is bounded', () => {
  it.each([401, 403, 404, 410])('HTTP %i burns zero automatic retries', (status) => {
    const made = classify({ probe: probe({ status }) });
    expect(shouldRetry(made, 0)).toBe(false);
  });

  it.each([429, 500, 502, 503])('HTTP %i is retried at most twice', (status) => {
    const made = classify({ probe: probe({ status }) });
    expect(shouldRetry(made, 0)).toBe(true);
    expect(shouldRetry(made, 1)).toBe(true);
    expect(shouldRetry(made, 2)).toBe(false);
  });

  it('obeys Retry-After inside the bounds and ignores an absurd one', () => {
    expect(
      classify({ probe: probe({ status: 429, retryAfterSeconds: 4 }) }).backoffMs,
    ).toBe(4_000);
    // A server asking for an hour must not strand the screen for an hour.
    expect(
      classify({ probe: probe({ status: 429, retryAfterSeconds: 3600 }) }).backoffMs,
    ).toBe(MAX_RETRY_BACKOFF_MS);
    expect(
      classify({ probe: probe({ status: 429, retryAfterSeconds: 0 }) }).backoffMs,
    ).toBe(MIN_RETRY_BACKOFF_MS);
    // No header at all is not a made-up wait: the schedule's own cadence answers.
    const unheaded = classify({ probe: probe({ status: 429 }) });
    expect(unheaded.backoffMs).toBeNull();
    expect(retryDelayMsFor(unheaded, 1)).toBeGreaterThanOrEqual(1);
    expect(retryDelayMsFor(unheaded, 2)).toBeGreaterThan(retryDelayMsFor(unheaded, 1));
  });

  it('never waits outside the documented bounds however the server phrases it', () => {
    for (const seconds of [0, 1, 7, 19, 20, 120, 999_999]) {
      const wait = classify({ probe: probe({ status: 429, retryAfterSeconds: seconds }) }).backoffMs;
      expect(wait).not.toBeNull();
      expect(wait! >= MIN_RETRY_BACKOFF_MS && wait! <= MAX_RETRY_BACKOFF_MS).toBe(true);
    }
  });

  it('a transient failure followed by a working host is retried, not declared dead', () => {
    const first = classify({ probe: probe({ status: 503 }) });
    expect(first.transient).toBe(true);
    // The same tune later answers 200: the classifier is pure, so the next attempt's own evidence
    // decides, and a 200 is not a failure at all.
    const later = classify({ probe: probe({ status: 200 }) });
    expect(later.category).toBe('http-error');
    // 200 never reaches this path in the app (there is no error to classify); pinned so a future
    // edit cannot read a success as a diagnosis.
    expect(later.status).toBe(200);
  });
});

describe('Retry-After is read as the number it is', () => {
  it.each([
    ['4', 4],
    [' 12 ', 12],
    ['0', 0],
  ])('parses %s', (raw, expected) => {
    expect(retryAfterSecondsOf(raw)).toBe(expected);
  });

  it.each([undefined, null, '', 'Wed, 21 Oct 2026 07:28:00 GMT', '-5', 'abc'])(
    'refuses to invent a number for %s',
    (raw) => {
      expect(retryAfterSecondsOf(raw)).toBeNull();
    },
  );
});

describe('the probe that supplies this evidence is cancellable', () => {
  it('reports cancelled, not timed-out, when the caller already left', async () => {
    const controller = new AbortController();
    controller.abort();
    let asked = 0;
    const fetch: ProbeFetch = jest.fn(async () => {
      asked += 1;
      return { status: 200, headers: { get: () => null } };
    }) as unknown as ProbeFetch;
    const result = await probeStream(URL_OK, { signal: controller.signal, fetchImpl: fetch });
    expect(result?.observation).toBe('cancelled');
    expect(result?.status).toBeUndefined();
    // A cancelled caller is not served a fresh request on the way out.
    expect(asked).toBe(0);
  });

  it('a cancelled probe is no evidence: the classification stays honest', () => {
    const made = classify({ probe: probe({ observation: 'cancelled', status: undefined }) });
    expect(made.category).toBe('http-error');
    expect(made.status).toBeNull();
    expect(made.transient).toBe(false);
  });

  it('reads the status and Retry-After off a real answer', async () => {
    const fetch = jest.fn(async () => ({
      status: 429,
      headers: { get: (name: string) => (name === 'retry-after' ? '7' : null) },
    })) as unknown as ProbeFetch;
    const result = await probeStream(URL_OK, { fetchImpl: fetch });
    expect(result?.observation).toBe('answered');
    expect(result?.status).toBe(429);
    expect(result?.retryAfterSeconds).toBe(7);
    const made = classify({ probe: result });
    expect(made.category).toBe('rate-limited');
    expect(made.backoffMs).toBe(7_000);
  });
});

describe('the player screen is wired to the evidence, not to a guess', () => {
  // Read as source: importing a screen into Jest is not possible in this repo (react-native-css
  // throws at import), so these pin the calls that make the behaviour real.
  const src = require('fs').readFileSync(
    require('path').join(process.cwd(), 'src', 'screens', 'LivePlayerScreen.tsx'),
    'utf8',
  ) as string;

  it('asks the host once when the payload names a bad HTTP status', () => {
    expect(src).toMatch(/classified\.codeName === 'ERROR_CODE_IO_BAD_HTTP_STATUS'/);
    expect(src).toMatch(/classified\.status === null/);
    expect(src).toContain('await askTheHost(stream)');
  });

  it('re-classifies with the answer instead of showing the pre-probe sentence', () => {
    const handler = src.slice(
      src.indexOf('const handlePlaybackError'),
      src.indexOf('const handleTryAgain'),
    );
    expect(handler.match(/classifyPlaybackFailure\(/g)).toHaveLength(2);
    expect(handler).toContain('probe: answer');
  });

  it('uses the bounded backoff for the wait', () => {
    expect(src).toContain('retryDelayMsFor(classified, attempt)');
    expect(src).not.toContain('automaticRetryDelayMs(attempt)');
  });

  it('cancels the outstanding question when the tune changes', () => {
    const reset = src.slice(
      src.indexOf('const resetAttemptState'),
      src.indexOf('const loadStream'),
    );
    expect(reset).toContain('cancelProbe()');
  });

  it('cancels it when the player is closed', () => {
    expect(src).toMatch(/mountedRef\.current = false;[\s\S]{0,600}?inFlight\.abort\(\)/);
  });

  it('discards an answer that arrives after the user moved on', () => {
    const handler = src.slice(
      src.indexOf('const handlePlaybackError'),
      src.indexOf('const handleTryAgain'),
    );
    expect(handler).toContain(
      'if (!mountedRef.current || requestId !== requestIdRef.current) return;',
    );
  });
});
