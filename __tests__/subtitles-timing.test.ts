/**
 * PHASE 14 — subtitle timing.
 *
 * Covers the two things the sync control depends on: that a cue's times are
 * parsed faithfully from the file (a dropped millisecond or a rejected
 * timestamp silently moves or deletes every caption), and that the offset the
 * user dials in means the same thing on both render paths — the JS overlay
 * looks a cue up at `currentTime - offset`, while the native path rewrites the
 * sidecar's timestamps by `+offset`. If those two disagree, the same button
 * press slides captions in opposite directions depending on a setting.
 */
import {
  findCueAt,
  parseSubtitleText,
  shiftSubtitleCues,
  type SubtitleCue,
} from '@/src/utils/subtitles';
import { isRtlLanguage } from '@/src/constants/languages';

const CUES: SubtitleCue[] = [
  { start: 10, end: 12, text: 'one' },
  { start: 20, end: 22, text: 'two' },
  { start: 30, end: 32, text: 'three' },
];

describe('parseSubtitleText', () => {
  it('keeps the sub-second part of SRT timestamps', () => {
    const srt = `1
00:00:01,250 --> 00:00:03,750
Hello

`;
    expect(parseSubtitleText(srt)).toEqual([
      { start: 1.25, end: 3.75, text: 'Hello' },
    ]);
  });

  it('accepts WebVTT timestamps written without an hour field', () => {
    // The spec allows `mm:ss.ttt`. Dropping these is not a partial failure:
    // every cue lands at 0 --> 0, `end > start` rejects all of them, and the
    // track simply renders nothing.
    const vtt = `WEBVTT

01:05.500 --> 01:08.000
Second line

00:01.000 --> 00:04.000
First line
`;
    // `00:01.000` is one second, `01:05.500` is 65.5s. Sorted by start, so the
    // cue listed second comes first.
    expect(parseSubtitleText(vtt)).toEqual([
      { start: 1, end: 4, text: 'First line' },
      { start: 65.5, end: 68, text: 'Second line' },
    ]);
  });

  it('ignores VTT cue settings that follow the end timestamp', () => {
    const vtt = `WEBVTT

00:00:10.000 --> 00:00:14.000 align:start position:0%
Styled line
`;
    expect(parseSubtitleText(vtt)).toEqual([
      { start: 10, end: 14, text: 'Styled line' },
    ]);
  });
});

describe('subtitle offset semantics', () => {
  const OFFSET = 7;

  it('a positive offset delays captions on the native path', () => {
    const shifted = shiftSubtitleCues(CUES, OFFSET);
    // 'two' runs 20..22, so delayed by 7s it occupies 27..29: silent where it
    // used to be, and audible seven seconds later.
    expect(findCueAt(shifted, 21)?.text).toBeUndefined();
    expect(findCueAt(shifted, 28)?.text).toBe('two');
  });

  it('the overlay lookup agrees with the shifted sidecar', () => {
    const shifted = shiftSubtitleCues(CUES, OFFSET);
    // For the same playhead, both paths must show the same caption.
    for (const at of [0, 9, 11, 17, 19, 21, 27, 29, 31, 40]) {
      const native = findCueAt(shifted, at)?.text ?? null;
      const overlay = findCueAt(CUES, at - OFFSET)?.text ?? null;
      expect(overlay).toBe(native);
    }
  });

  it('clamps a cue shifted across the start of the file, drops one fully past it', () => {
    // Negative offset = captions earlier. A cue that would end before t=0
    // cannot be shown at all; one that only starts before it keeps its text
    // from t=0.
    const early: SubtitleCue[] = [
      { start: 2, end: 4, text: 'survives' },
      { start: 1, end: 2, text: 'gone' },
    ];
    expect(shiftSubtitleCues(early, -3)).toEqual([
      { start: 0, end: 1, text: 'survives' },
    ]);
  });

  it('returns the same array for a zero offset', () => {
    expect(shiftSubtitleCues(CUES, 0)).toBe(CUES);
  });
});

describe('findCueAt', () => {
  it('returns null between cues', () => {
    expect(findCueAt(CUES, 15)).toBeNull();
  });

  it('handles an empty track', () => {
    expect(findCueAt([], 5)).toBeNull();
  });
});

describe('isRtlLanguage', () => {
  it('flags scripts that need right-to-left layout', () => {
    for (const code of ['ur', 'ar', 'he', 'fa', 'ps', 'yi']) {
      expect(isRtlLanguage(code)).toBe(true);
    }
  });

  it('does not flag languages whose script direction cannot be trusted', () => {
    // Devanagari (hi) and Tamil (ta) are written left-to-right even though they
    // are South-Asian scripts, so they must not be mirrored. Kurdish and Sindhi
    // go either way depending on variety, and an ISO 639-1 code cannot tell us.
    for (const code of [
      'en',
      'hi',
      'ta',
      'te',
      'bn',
      'zh',
      'ja',
      'ku',
      'sd',
      'und',
      '',
    ]) {
      expect(isRtlLanguage(code)).toBe(false);
    }
  });

  it('is case-insensitive and tolerates region subtags', () => {
    expect(isRtlLanguage('UR')).toBe(true);
    expect(isRtlLanguage('ur-PK')).toBe(true);
    expect(isRtlLanguage(' fa ')).toBe(true);
  });
});
