/**
 * Owner: "first the issue with live channels", after the run-41 device test.
 *
 * The screen said: `turnerlive.warnermediacdn.com answered with HTTP 200, which this app has no
 * rule for yet`, next to `ERROR_CODE_IO_BAD_HTTP_STATUS (22004)`. Both halves were true, and the
 * sentence was still useless, because a live HLS stream is not one request. Measured from this
 * machine against the same catalogue entry:
 *
 *   GET https://turnerlive.warnermediacdn.com/hls/live/2023172/tbseast/slate/VIDEO_0_3564000.m3u8
 *     -> 403 text/html  "Access Denied ... You don't have permission to access ..."
 *   HEAD on the same URL -> 403 as well, and with a player-shaped User-Agent, and with a Referer.
 *   The playlist entry itself is labelled `TBS (720p) [Geo-blocked]`.
 *
 * So the publisher answers the *media* request differently from the *listing* request, and the only
 * thing a single top-level probe can honestly say about a 200 is that one request succeeded. This
 * file pins the fix: ask once more for the first resource that 200 pointed at, and classify the
 * refusal the player actually met — while never claiming more than the two requests observed.
 */
import { readFileSync } from 'fs';
import path from 'path';

import {
  classifyPlaybackFailure,
  shouldRetry,
} from '@/src/services/liveTv/playbackFailure';
import {
  firstPlaylistChildOf,
  probeStreamChain,
  resolvePlaylistChild,
  type ProbeFetch,
  type StreamProbeResult,
} from '@/src/services/liveTv/streamProbe';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const LISTING = 'https://turnerlive.warnermediacdn.com/hls/live/2023172/tbseast/slate/VIDEO_0_3564000.m3u8';

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3564000,RESOLUTION=1280x720\n720.m3u8\n';
const MEDIA = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nseg-1.ts\n';
const WITH_KEY = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.invalid/k?key=SECRET"\n#EXTINF:4.0,\nseg-1.ts\n';

const response = (
  status: number,
  headers: Record<string, string> = {},
  body?: string,
): {
  status: number;
  headers: { get: (n: string) => string | null };
  text?: () => Promise<string>;
} => {
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) lower[name.toLowerCase()] = value;
  return {
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    ...(body === undefined ? {} : { text: async () => body }),
  };
};

const HLS = { 'content-type': 'application/vnd.apple.mpegurl' };
const HTML = { 'content-type': 'text/html' };

/** A CDN that serves the listing and refuses everything behind it — the Turner shape. */
const serve = (rules: Record<string, ReturnType<typeof response>>): ProbeFetch =>
  async (url) => rules[url] ?? response(404, HTML, '<HTML>Not found</HTML>');

const probe = (over: Partial<StreamProbeResult> = {}): StreamProbeResult => ({
  observation: 'answered',
  host: 'turnerlive.warnermediacdn.com',
  ms: 140,
  method: 'GET',
  detail: 'HTTP 200',
  status: 200,
  contentType: 'application/vnd.apple.mpegurl',
  resourceKind: 'manifest',
  bodyPreview: MASTER,
  ...over,
});

const child = (over: Partial<StreamProbeResult> = {}): StreamProbeResult => ({
  ...probe(),
  status: 403,
  contentType: 'text/html',
  resourceKind: 'other',
  bodyPreview: '<HTML><HEAD><TITLE>Access Denied</TITLE>',
  detail: 'HTTP 403',
  ...over,
});

const badStatus = {
  error: { errorString: 'ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS', errorCode: '22004' },
};

const classify = (over: Record<string, unknown> = {}) =>
  classifyPlaybackFailure({
    payload: badStatus,
    url: LISTING,
    probe: null,
    playbackStarted: false,
    ...over,
  });

describe('the child a playlist points at', () => {
  it('takes the variant under EXT-X-STREAM-INF, not the master itself', () => {
    expect(firstPlaylistChildOf(MASTER, LISTING)).toEqual({
      kind: 'media-playlist',
      url: 'https://turnerlive.warnermediacdn.com/hls/live/2023172/tbseast/slate/720.m3u8',
    });
  });

  it('takes the first segment of a media playlist', () => {
    const found = firstPlaylistChildOf(MEDIA, 'https://h.invalid/a/b/index.m3u8');
    expect(found?.kind).toBe('segment');
    expect(found?.url).toBe('https://h.invalid/a/b/seg-1.ts');
  });

  it('names an encryption key first, because the player fetches it before any media', () => {
    expect(firstPlaylistChildOf(WITH_KEY, LISTING)?.kind).toBe('encryption-key');
  });

  it('says nothing about a body with no child in it', () => {
    expect(firstPlaylistChildOf('#EXTM3U\n#EXT-X-ENDLIST\n', LISTING)).toBeNull();
    expect(firstPlaylistChildOf(null, LISTING)).toBeNull();
    expect(firstPlaylistChildOf('', LISTING)).toBeNull();
  });

  it('refuses a data: reference and an unresolvable one', () => {
    expect(resolvePlaylistChild(LISTING, 'data:image/png;base64,AA')).toBeNull();
    expect(resolvePlaylistChild(LISTING, '   ')).toBeNull();
    expect(resolvePlaylistChild(LISTING, '#EXT-X-DISCONTINUITY')).toBeNull();
  });
});

describe('probeStreamChain — two requests, never three', () => {
  it('follows a 200 listing into the resource it names', async () => {
    const chain = await probeStreamChain(LISTING, {
      fetchImpl: serve({
        [LISTING]: response(200, HLS, MASTER),
        'https://turnerlive.warnermediacdn.com/hls/live/2023172/tbseast/slate/720.m3u8':
          response(403, HTML, '<HTML>Access Denied</HTML>'),
      }),
    });
    expect(chain?.top.status).toBe(200);
    expect(chain?.child?.status).toBe(403);
    expect(chain?.childKind).toBe('media-playlist');
  });

  it('does not ask a second question when the first answer already failed', async () => {
    const urls: string[] = [];
    const spy: ProbeFetch = async (url) => {
      urls.push(url);
      return response(404, HTML, '<HTML>Not found</HTML>');
    };
    const chain = await probeStreamChain(LISTING, { fetchImpl: spy });
    expect(urls).toEqual([LISTING]);
    expect(chain?.child).toBeNull();
  });

  it('does not walk into a 200 that is not a playlist — there is nothing to follow', async () => {
    const urls: string[] = [];
    const spy: ProbeFetch = async (url) => {
      urls.push(url);
      return response(200, HTML, '<HTML><BODY>Log in to continue</BODY></HTML>');
    };
    const chain = await probeStreamChain(LISTING, { fetchImpl: spy });
    expect(urls).toEqual([LISTING]);
    expect(chain?.child).toBeNull();
  });

  it('stops after the listing when the caller has already left the channel', async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const spy: ProbeFetch = async (url) => {
      urls.push(url);
      controller.abort();
      return response(200, HLS, MASTER);
    };
    const chain = await probeStreamChain(LISTING, { fetchImpl: spy, signal: controller.signal });
    expect(urls).toEqual([LISTING]);
    expect(chain?.child).toBeNull();
  });

  it('carries the stream headers to both requests, since the refusal may be about them', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const spy: ProbeFetch = async (url, init) => {
      seen.push(init.headers as Record<string, unknown>);
      return url === LISTING
        ? response(200, HLS, MASTER)
        : response(200, HLS, MEDIA);
    };
    await probeStreamChain(LISTING, { fetchImpl: spy, headers: { Referer: 'https://example.invalid/' } });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ Referer: 'https://example.invalid/' });
    expect(seen[1]).toMatchObject({ Referer: 'https://example.invalid/' });
  });

  it('never lets a signed child URL out of the result it returns', async () => {
    const chain = await probeStreamChain(LISTING, {
      fetchImpl: serve({
        [LISTING]: response(200, HLS, WITH_KEY),
        'https://cdn.example.invalid/k?key=SECRET': response(403, HTML),
      }),
    });
    expect(chain?.child?.status).toBe(403);
    expect(JSON.stringify(chain)).not.toContain('SECRET');
  });
});

describe('a refusal below the listing is reported as the refusal it is', () => {
  it('calls a restricted feed restricted, and stops saying the app has no rule for a 200', () => {
    const failure = classify({
      probe: probe(),
      chain: { top: probe(), child: child(), childKind: 'media-playlist' },
    });
    expect(failure.category).toBe('access-rejected');
    expect(failure.status).toBe(403);
    expect(failure.refusedResource).toBe('media-playlist');
    expect(failure.message).toMatch(/gave out the channel address but refused the video list/i);
    expect(failure.message).toMatch(/403/);
    expect(failure.message).not.toMatch(/no rule/i);
  });

  it('burns no retry on it, because the publisher is not going to change its mind in four seconds', () => {
    const failure = classify({
      probe: probe(),
      chain: { top: probe(), child: child(), childKind: 'media-playlist' },
    });
    expect(failure.transient).toBe(false);
    expect(shouldRetry(failure, 0)).toBe(false);
  });

  it('names an encryption key when that is what was refused', () => {
    const failure = classify({
      probe: probe(),
      chain: { top: probe(), child: child(), childKind: 'encryption-key' },
    });
    expect(failure.message).toMatch(/refused its encryption key/i);
  });

  it('reads a vanished child as gone and a failing origin as the publisher’s problem', () => {
    const gone = classify({
      probe: probe(),
      chain: { top: probe(), child: child({ status: 404 }), childKind: 'segment' },
    });
    expect(gone.category).toBe('stream-gone');
    expect(gone.transient).toBe(false);

    const origin = classify({
      probe: probe(),
      chain: { top: probe(), child: child({ status: 503, detail: 'HTTP 503' }), childKind: 'segment' },
    });
    expect(origin.category).toBe('upstream-unreachable');
    expect(origin.transient).toBe(true);
  });

  it('says a 200 that serves a web page is a stale address, not an unclassifiable status', () => {
    const failure = classify({
      probe: probe({
        contentType: 'text/html',
        resourceKind: 'other',
        bodyPreview: '<HTML><BODY>Account required</BODY></HTML>',
      }),
      chain: null,
    });
    expect(failure.category).toBe('invalid-manifest');
    expect(failure.message).toMatch(/sent a web page, not a stream/i);
    expect(failure.message).not.toMatch(/no rule/i);
  });

  it('keeps its silence when both requests succeeded: that is a player problem, not an HTTP one', () => {
    const failure = classify({
      probe: probe(),
      chain: { top: probe(), child: child({ status: 200, detail: 'HTTP 200', resourceKind: 'media-playlist' }), childKind: 'media-playlist' },
    });
    expect(failure.refusedResource).toBeNull();
    expect(failure.message).not.toMatch(/403|404|503/);
    expect(failure.message).not.toMatch(/your (connection|wi-fi|internet)/i);
  });

  it('is unchanged when no second request was made at all', () => {
    const topOnly = classify({
      probe: probe({ status: 404, detail: 'HTTP 404' }),
      chain: { top: probe({ status: 404 }), child: null, childKind: null },
    });
    expect(topOnly.category).toBe('stream-gone');
    expect(topOnly.status).toBe(404);
  });
});

describe('the player screen asks the chain, not the single URL', () => {
  const screen = read('src/screens/LivePlayerScreen.tsx');

  it('uses the two-request probe and hands both answers to the classifier', () => {
    expect(screen).toContain('probeStreamChain(url, {');
    expect(screen).not.toMatch(/await probeStream\(/);
    expect(screen).toMatch(/probe: answer\.top,\s*chain: answer,/);
  });

  it('keeps the cancellation that makes the second request safe', () => {
    expect(screen).toMatch(/probeStreamChain\(url, \{\s*headers: target\.headers,\s*signal: controller\.signal,/);
    expect(screen).toContain('cancelProbe');
  });
});
