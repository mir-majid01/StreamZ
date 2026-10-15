/**
 * PHASE 15 — audio track selection.
 *
 * The list must come only from what the player reported, name a track only the
 * way the stream named it, and never assert which track is playing unless
 * somebody actually said so. react-native-video's `AudioTrack` carries a
 * `selected` flag, so the player does tell us when it knows — guessing "the
 * first one" is what turns an unknown into a lie on screen.
 */
import type { AudioTrack } from 'react-native-video';
import {
  audioTracksNotice,
  resolveActiveAudioIndex,
  toAudioTrackOptions,
} from '@/src/utils/audioTracks';

const track = (over: Partial<AudioTrack> & { index: number }): AudioTrack => ({
  title: undefined,
  language: undefined,
  bitrate: undefined,
  type: undefined,
  selected: undefined,
  ...over,
});

describe('toAudioTrackOptions', () => {
  it('uses the name the stream gave the track', () => {
    const options = toAudioTrackOptions([
      track({ index: 0, title: 'Director commentary' }),
      track({ index: 1, language: 'hi' }),
    ]);
    expect(options).toEqual([
      { index: 0, label: 'Director commentary' },
      { index: 1, label: 'hi' },
    ]);
  });

  it('falls back to a neutral position label instead of inventing a language', () => {
    // Most scraped streams carry audio with no name at all. Guessing "English"
    // would promise a language the app never learned (see the Videasy fix).
    const options = toAudioTrackOptions([
      track({ index: 0 }),
      track({ index: 1 }),
      track({ index: 4 }),
    ]);
    expect(options.map((o) => o.label)).toEqual([
      'Track 1',
      'Track 2',
      'Track 3',
    ]);
    // Selection still happens by the player's own index, not the display number.
    expect(options[2].index).toBe(4);
  });

  it('ignores blank titles rather than rendering an empty row', () => {
    const options = toAudioTrackOptions([
      track({ index: 0, title: '   ', language: 'en' }),
    ]);
    expect(options[0].label).toBe('en');
  });

  it('handles a stream that reports no audio tracks', () => {
    expect(toAudioTrackOptions([])).toEqual([]);
  });
});

describe('resolveActiveAudioIndex', () => {
  const TRACKS = [
    track({ index: 0, language: 'en' }),
    track({ index: 1, language: 'hi', selected: true }),
    track({ index: 2, language: 'ta' }),
  ];

  it('honours the user pick over the player report', () => {
    expect(resolveActiveAudioIndex(TRACKS, 2)).toBe(2);
  });

  it('asks the player which track is playing when the user has not picked', () => {
    expect(resolveActiveAudioIndex(TRACKS, null)).toBe(1);
  });

  it('reports no active track when nothing was picked and the player never said', () => {
    const silent = [track({ index: 0 }), track({ index: 1 })];
    expect(resolveActiveAudioIndex(silent, null)).toBeNull();
  });

  it('does not treat index 0 as the default answer', () => {
    // The regression this guards: with no `selected` flag anywhere, the drawer
    // used to light up the first row and name it as what you were hearing.
    const silent = [
      track({ index: 0, title: 'One' }),
      track({ index: 1, title: 'Two' }),
    ];
    expect(resolveActiveAudioIndex(silent, null)).not.toBe(0);
  });

  it('takes the first reported selection if the player marks several', () => {
    const odd = [
      track({ index: 0, selected: true }),
      track({ index: 1, selected: true }),
    ];
    expect(resolveActiveAudioIndex(odd, null)).toBe(0);
  });

  it('still reports a pick the player has since marked selected', () => {
    expect(resolveActiveAudioIndex(TRACKS, 1)).toBe(1);
  });
});

describe('audioTracksNotice', () => {
  it('says nothing when there is something to pick', () => {
    expect(audioTracksNotice(2, true)).toBeNull();
  });

  it('separates a stream with no separable audio from one not yet reported', () => {
    // Both render as an empty list, and only one of them is a fact about the stream.
    expect(audioTracksNotice(0, true)).toContain('no separate audio tracks');
    expect(audioTracksNotice(0, false)).toContain('once the stream has reported');
  });

  it('does not claim a track count it was not given', () => {
    // A report of zero tracks is not evidence of "one muxed track" — saying that
    // would describe the stream, not what the player said.
    expect(audioTracksNotice(0, true)).not.toMatch(/muxed|one track/i);
  });
});
