/**
 * The live player used to drop the payload its own onError handed it, so every failure —
 * publisher offline, host refusing the request, container the device cannot decode — produced
 * the same unreportable sentence. These cover what is now kept, and the one field that is
 * deliberately never kept.
 */
import { livePlaybackDetail } from '@/src/services/liveTv/playbackError';

describe('livePlaybackDetail', () => {
  it('keeps the Android error name and code', () => {
    // ReactExoplayerView.java:1994-2015 builds exactly this shape.
    expect(
      livePlaybackDetail({
        error: {
          errorString: 'ExoPlaybackException: IOERROR',
          errorCode: '20001',
        },
      }),
    ).toBe('ExoPlaybackException: IOERROR (20001)');
  });

  it('keeps the iOS description and numeric code', () => {
    expect(
      livePlaybackDetail({
        error: { localizedDescription: 'The media is corrupt.', code: -1011 },
      }),
    ).toBe('The media is corrupt. (-1011)');
  });

  it('works when only one half of the pair is present', () => {
    expect(livePlaybackDetail({ error: { errorString: 'ExoPlaybackException: BAD_FORMAT' } })).toBe(
      'ExoPlaybackException: BAD_FORMAT',
    );
    expect(livePlaybackDetail({ error: { errorCode: '3003' } })).toBe('code 3003');
    expect(livePlaybackDetail({ error: { errorString: '   ' } })).toBeNull();
  });

  it('says nothing when the player reported nothing', () => {
    expect(livePlaybackDetail({})).toBeNull();
    expect(livePlaybackDetail({ error: undefined })).toBeNull();
    expect(livePlaybackDetail({ error: {} })).toBeNull();
  });

  it('never repeats the stack trace, which quotes the data URI', () => {
    // An ExoPlayer IOException names the failing URL in its message, and a playlist token
    // lives in that URL. The stack trace stays in the payload and out of the screen.
    const secret =
      'java.io.IOException: HTTP Error 403: https://cdn.example/live/master.m3u8?token=REDACTED-ME\n\tat com.google.android.exoplayer2.upstream.http.ConnectionStatusUtil';
    const detail = livePlaybackDetail({
      error: { errorString: 'ExoPlaybackException: IOERROR', errorCode: '20001', errorException: secret },
    });
    expect(detail).toBe('ExoPlaybackException: IOERROR (20001)');
    expect(detail).not.toContain('REDACTED-ME');
    expect(detail).not.toContain('cdn.example');
    expect(detail).not.toContain('token');
  });

  it('does not fall back to the stack trace when the error name is missing', () => {
    // The case that matters: a future edit that reaches for errorException as a fallback
    // would print a URL, with its access token, on a screen the user can screenshot.
    const secret =
      'com.google.android.exoplayer2.ExoPlayerPlaybackException: java.io.IOException: https://cdn.example/master.m3u8?token=REDACTED-ME';
    const detail = livePlaybackDetail({ error: { errorException: secret, errorCode: '20001' } });
    expect(detail).toBe('code 20001');
    expect(detail).not.toContain('REDACTED-ME');
    expect(detail).not.toContain('cdn.example');
  });
});
