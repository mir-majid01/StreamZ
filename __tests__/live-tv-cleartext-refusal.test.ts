/**
 * A device that refuses to open a plain-HTTP stream and a broadcaster whose server is down look
 * identical to media3: both surface as `ERROR_CODE_IO_NETWORK_CONNECTION_FAILED`. Before this,
 * the app told viewers their channel was offline when the phone itself had blocked the request —
 * the exact message a real screenshot of this build produced for `107.167.16.138`.
 *
 * The strings below are the shape Android actually emits, taken from that on-device failure.
 */
import { classifyPlaybackFailure } from '@/src/services/liveTv/playbackFailure';

const URL = 'http://107.167.16.138/live/news/index.m3u8';

const connectionFailed = (stackTail: string) => ({
  error: {
    errorString: 'ExoPlaybackException: ERROR_CODE_IO_NETWORK_CONNECTION_FAILED',
    errorCode: '22001',
    errorException: 'androidx.media3.exoplayer.ExoPlaybackException: Source error',
    errorStackTrace:
      'androidx.media3.datasource.HttpDataSource$HttpDataSourceException: java.io.IOException: ' +
      stackTail,
  },
});

describe('a cleartext refusal is not a dead broadcaster', () => {
  const blocked = classifyPlaybackFailure({
    url: URL,
    payload: connectionFailed(
      'java.util.concurrent.ExecutionException: java.net.UnknownServiceException: ' +
        'CLEARTEXT communication to 107.167.16.138 not permitted by network security policy',
    ),
  });

  it('is classified as a refusal rather than an unreachable host', () => {
    expect(blocked.category).toBe('access-rejected');
  });

  it('says the device will not play an unsecured stream', () => {
    expect(blocked.message).toContain('plain HTTP');
    expect(blocked.message).not.toMatch(/offline|unreachable/i);
  });

  it('does not spend retries on a rule the device will keep enforcing', () => {
    expect(blocked.transient).toBe(false);
  });
});

describe('a genuine connection failure keeps its own words', () => {
  const dead = classifyPlaybackFailure({
    url: URL,
    payload: connectionFailed('java.net.ConnectException: failed to connect to /107.167.16.138'),
  });

  it('is still reported as unreachable', () => {
    expect(dead.category).toBe('dns-or-unreachable');
    expect(dead.message).toMatch(/offline|unreachable/i);
  });

  it('never claims a cleartext problem it did not see', () => {
    expect(dead.message).not.toContain('plain HTTP');
  });
});
