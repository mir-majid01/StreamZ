/**
 * The three configured playlists hold 13,389 channels. 96.45% of iptv-org and 86.16% of
 * Free-TV entries are HLS, but 148 are DASH or a progressive container, and the live player
 * used to tell the native layer "HLS" for every one of them that was not literally named
 * `.mpd`. react-native-video builds the ExoPlayer media source from that hint and never
 * sniffs the response, so those entries failed as a malformed playlist rather than playing.
 */
import { liveSourceType } from '@/src/services/liveTv/sourceType';

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
