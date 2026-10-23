/**
 * The three configured playlists hold 13,389 channels. 96.45% of iptv-org and 86.16% of
 * Free-TV entries are HLS, but 148 are DASH or a progressive container, and the live player
 * used to tell the native layer "HLS" for every one of them that was not literally named
 * `.mpd`. react-native-video builds the ExoPlayer media source from that hint and never
 * sniffs the response, so those entries failed as a malformed playlist rather than playing.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { liveSourceType, urlDeclaresContainer } from '@/src/services/liveTv/sourceType';
import type { StreamProbeResult } from '@/src/services/liveTv/streamProbe';

const ROOT = path.resolve(__dirname, '..');
const screen = readFileSync(path.join(ROOT, 'src/screens/LivePlayerScreen.tsx'), 'utf8');

describe('liveSourceType', () => {
  it('marks the dominant case, HLS with and without an extension', () => {
    expect(liveSourceType('https://d.example/live/a/index.m3u8')).toBe('m3u8');
    expect(liveSourceType('https://d.example/live/a/index.m3u')).toBe('m3u8');
    // 274 iptv-org and 250 Free-TV stream URLs carry no extension at all.
    expect(liveSourceType('https://d.example/real/CH.NEWS/idx.m3u8')).toBe('m3u8');
    expect(liveSourceType('https://d.example/real/CH_NEWS')).toBe('m3u8');
  });

  it('marks DASH so the player builds an MPD source', () => {
    expect(liveSourceType('https://d.example/stream/manifest.mpd')).toBe('mpd');
    expect(liveSourceType('https://d.example/stream/manifest.mpd?sid=3&t=ab')).toBe('mpd');
    expect(liveSourceType('https://d.example/stream/manifest.MPD')).toBe('mpd');
  });

  it('says nothing about progressive containers and lets the player infer', () => {
    for (const url of [
      'https://d.example/vod/clip.mp4',
      'https://d.example/vod/clip.mkv',
      'https://d.example/vod/clip.webm',
      'https://d.example/vod/clip.mov',
      'https://d.example/ts/segment.ts',
    ]) {
      expect(liveSourceType(url)).toBeUndefined();
    }
  });

  it('ignores the query and the host when looking for a container', () => {
    // The hint is the path only: a host or token that happens to contain an extension must
    // not decide which reader is built.
    expect(liveSourceType('https://live.mpd.example.mpd:443/edge/index.m3u8')).toBe('m3u8');
    expect(liveSourceType('https://h.example/render?path=/a/b.mp4')).toBe('m3u8');
    expect(liveSourceType('https://h.example/a/index.m3u8#x-playlist')).toBe('m3u8');
  });

  it('handles the shapes the catalogues actually contain', () => {
    expect(liveSourceType('https://d.example/a/b/')).toBe('m3u8');
    expect(liveSourceType('https://d.example/a/index.m3u8;code=abc')).toBe('m3u8');
    expect(liveSourceType('/relative/only.m3u8')).toBe('m3u8');
    expect(liveSourceType('weird value')).toBe('m3u8');
    expect(liveSourceType('')).toBe('m3u8');
  });

  it('never returns a type the native layer does not understand', () => {
    const samples = [
      'https://d.example/a/index.m3u8',
      'https://d.example/a/manifest.mpd',
      'https://d.example/a/clip.mp4',
      'https://d.example/a/raw',
      'https://d.example/a/segment.ts',
    ];
    for (const url of samples) {
      expect(['m3u8', 'mpd', undefined]).toContain(liveSourceType(url));
    }
  });
});

/**
 * Why the extensionless default stays `m3u8`, and why a probe is allowed to overrule it.
 *
 * `ReactExoplayerView.buildMediaSource` (react-native-video 6.19.2, line 1007) decides the source
 * with `Util.inferContentType(overrideExtension ? "." + overrideExtension :
 * uri.getLastPathSegment())`, and media3 1.11.1's `inferContentTypeForExtension` matches exactly
 * four strings — `mpd`, `m3u8`, `ism`, `isml` — with anything else coming back as
 * `CONTENT_TYPE_OTHER`, which this library builds as a `ProgressiveMediaSource`. So passing no
 * hint for an extensionless URL is not "let ExoPlayer infer": it is a container reader that cannot
 * parse an HLS playlist, guaranteeing a parse error for the majority of the catalogue. The native
 * layer has no channel for the server's `Content-Type`, which leaves the app one way to know
 * better than the filename — and that is what the retry-path probe is for.
 */
describe('liveSourceType with a probe', () => {
  const answered = (
    contentType: string | null,
  ): StreamProbeResult => ({
    observation: 'answered',
    host: 'd.example',
    ms: 40,
    status: 200,
    contentType,
    method: 'HEAD',
    detail: 'HTTP 200',
  });

  it('takes the container from the server when the server says', () => {
    // The 524 extensionless entries: the heuristic guessed HLS, and here it is confirmed.
    expect(
      liveSourceType('https://d.example/real/CH_NEWS', answered('application/vnd.apple.mpegurl')),
    ).toBe('m3u8');
    // A server that answers DASH at an extensionless path now gets a DASH source.
    expect(
      liveSourceType('https://d.example/manifest', answered('application/dash+xml')),
    ).toBe('mpd');
    // And a progressive file behind a URL that looks like a playlist stops being sent to the HLS
    // parser — the exact bug 915870c fixed, now caught by observation instead of by filename.
    expect(liveSourceType('https://d.example/edge/feed', answered('video/mp2t'))).toBeUndefined();
  });

  it('falls back to the extension heuristic when the probe saw nothing about format', () => {
    // octet-stream is what many IPTV CDNs answer for HLS; reading it as a container claim would be
    // a worse guess than the one the catalogue supports.
    expect(liveSourceType('https://d.example/real/CH_NEWS', answered('application/octet-stream'))).toBe('m3u8');
    expect(liveSourceType('https://d.example/real/CH_NEWS', answered(null))).toBe('m3u8');
    expect(liveSourceType('https://d.example/a/index.m3u8', answered('text/html'))).toBe('m3u8');
    // A probe that never reached the server is not evidence about anything.
    expect(
      liveSourceType('https://d.example/real/CH_NEWS', {
        observation: 'host-did-not-resolve',
        host: 'd.example',
        ms: 3,
        method: 'HEAD',
        detail: 'unknownhostexception',
      }),
    ).toBe('m3u8');
    expect(liveSourceType('https://d.example/a/clip.mp4', null)).toBeUndefined();
  });
});

describe('urlDeclaresContainer decides whether a tune may start without asking', () => {
  it('trusts the extension for the shapes that name their container', () => {
    expect(urlDeclaresContainer('https://d.example/live/a/index.m3u8')).toBe(true);
    expect(urlDeclaresContainer('https://d.example/live/a/index.m3u')).toBe(true);
    expect(urlDeclaresContainer('https://d.example/live/a/manifest.mpd')).toBe(true);
    expect(urlDeclaresContainer('https://d.example/clip.mp4')).toBe(true);
    expect(urlDeclaresContainer('https://d.example/live/a/stream.ts')).toBe(true);
    // A query string must not hide the extension.
    expect(urlDeclaresContainer('https://d.example/a/index.m3u8?token=7')).toBe(true);
  });

  it('refuses to guess for the paths that say nothing', () => {
    expect(urlDeclaresContainer('https://d.example/real/CH_NEWS')).toBe(false);
    // The measured shape that started this: HTTP 200, video/mp2t, no extension anywhere.
    expect(urlDeclaresContainer('http://telekomsrbije.com:2095/play/lhpjmkfVyhON1JAiZCx7vgvje3t')).toBe(false);
  });

  it('survives a URL the parser cannot read', () => {
    expect(urlDeclaresContainer('not a url at all')).toBe(false);
    expect(urlDeclaresContainer('d.example/live/index.m3u8')).toBe(true);
  });
});

describe('the live player asks the host before the first tune when the URL does not say', () => {
  it('primes the container only for the URLs that need it', () => {
    const prime = /const primeContainer = useCallback\(\s*async \(target: LiveStream\)[\s\S]*?\n {2}\);/.exec(screen);
    expect(prime).not.toBeNull();
    expect(prime![0]).toContain('urlDeclaresContainer(target.url)');
    expect(prime![0]).toContain('await askTheHost(target)');
  });

  it('resolves the stream, asks, and only then hands the URL to the player', () => {
    const start = screen.indexOf('const loadStream = useCallback');
    const region = screen.slice(start, screen.indexOf('}, [primeContainer, resetAttemptState])', start));
    const get = region.indexOf('DaddyLiveService.getStream');
    const prime = region.indexOf('await primeContainer(resolved)');
    const hand = region.indexOf('setStream(resolved)');
    expect(get).toBeGreaterThan(-1);
    expect(prime).toBeGreaterThan(get);
    expect(hand).toBeGreaterThan(prime);
  });

  it('keeps the newest request in charge when the answer arrives late', () => {
    const at = screen.indexOf('await primeContainer(resolved)');
    const after = screen.slice(at, screen.indexOf('setStream(resolved)', at));
    expect(after).toContain('requestId !== requestIdRef.current');
  });

  it('does not skip the question for a stream handed over by the caller', () => {
    const at = screen.indexOf('await primeContainer(initialStream)');
    expect(at).toBeGreaterThan(-1);
    const after = screen.slice(at, screen.indexOf('DaddyLiveService.pushRecent(initialChannel.id)', at));
    expect(after).toContain('requestId !== requestIdRef.current');
    expect(after).toContain('setStream(initialStream)');
    expect(after).toContain('setLoading(false)');
  });
});
