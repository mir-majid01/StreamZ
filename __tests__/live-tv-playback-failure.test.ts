/**
 * The live player used to answer every failure with the same dead-end sentence. These pin the
 * other half of that fix: the classifier's mapping from media3's own codes to a named category,
 * and the two rules that keep a diagnosis honest — `transient` is true only where a retry can
 * plausibly come out differently, and nothing is called DNS unless something actually named a
 * resolution failure.
 *
 * Every code name and number below was read out of `androidx.media3.common.PlaybackException`
 * from androidx.media3:media3-common:1.11.1 (the version react-native-video 6.19.2 resolves),
 * with `javap -constants`. The `2` prefix on the wire code is react-native-video's own:
 * ReactExoplayerView.java:1995 emits `"2" + e.errorCode`.
 */
import {
  MAX_AUTOMATIC_LIVE_RETRIES,
  automaticRetryDelayMs,
  automaticRetryNotice,
  classifyPlaybackFailure,
  shouldRetry,
  type PlaybackFailureCategory,
} from '@/src/services/liveTv/playbackFailure';
import type { PlayerErrorPayload } from '@/src/services/liveTv/playbackError';
import type { StreamProbeResult } from '@/src/services/liveTv/streamProbe';

const STREAM_URL = 'https://cdn.example-live.invalid/real/star-sports-1/idx.m3u8';

/** The payload shape ReactExoplayerView.onPlayerError builds on Android. */
const exo = (name: string, code: number): PlayerErrorPayload => ({
  error: {
    errorString: `ExoPlaybackException: ${name}`,
    errorCode: `2${code}`,
  },
});

const probeOf = (partial: Partial<StreamProbeResult> & { observation: StreamProbeResult['observation'] }): StreamProbeResult => ({
  host: 'cdn.example-live.invalid',
  ms: 120,
  method: 'HEAD',
  detail: '',
  ...partial,
});

describe('classifyPlaybackFailure — media3 code mapping', () => {
  const cases: ReadonlyArray<readonly [string, number, PlaybackFailureCategory]> = [
    ['ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001, 'dns-or-unreachable'],
    ['ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', 2002, 'connection-timeout'],
    ['ERROR_CODE_TIMEOUT', 1003, 'connection-timeout'],
    ['ERROR_CODE_IO_BAD_HTTP_STATUS', 2004, 'http-error'],
    ['ERROR_CODE_IO_FILE_NOT_FOUND', 2005, 'http-error'],
    ['ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE', 2003, 'unsupported-format'],
    ['ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED', 3003, 'unsupported-format'],
    ['ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED', 3004, 'unsupported-format'],
    ['ERROR_CODE_DECODER_INIT_FAILED', 4001, 'unsupported-format'],
    ['ERROR_CODE_DECODER_QUERY_FAILED', 4002, 'unsupported-format'],
    ['ERROR_CODE_DECODING_FAILED', 4003, 'unsupported-format'],
    ['ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES', 4004, 'unsupported-format'],
    ['ERROR_CODE_DECODING_FORMAT_UNSUPPORTED', 4005, 'unsupported-format'],
    // An AC-3/E-AC-3 audio track on a device without a decoder for it: a stream fact, not a
    // network one, which is why it must not read as a connection error.
    ['ERROR_CODE_AUDIO_TRACK_INIT_FAILED', 5001, 'unsupported-format'],
    ['ERROR_CODE_AUDIO_TRACK_WRITE_FAILED', 5002, 'unsupported-format'],
    ['ERROR_CODE_IO_NO_PERMISSION', 2006, 'access-rejected'],
    ['ERROR_CODE_IO_CLEARTEXT_NOT_PERMITTED', 2007, 'access-rejected'],
    ['ERROR_CODE_PARSING_MANIFEST_MALFORMED', 3002, 'invalid-manifest'],
    ['ERROR_CODE_PARSING_CONTAINER_MALFORMED', 3001, 'invalid-manifest'],
    ['ERROR_CODE_BEHIND_LIVE_WINDOW', 1002, 'stream-expired'],
  ];

  it.each(cases)('%s (%i) is %s', (name, code, category) => {
    const failure = classifyPlaybackFailure({ payload: exo(name, code), url: STREAM_URL });
    expect(failure.category).toBe(category);
    expect(failure.codeName).toBe(name);
    expect(failure.code).toBe(code);
  });

  it('maps the code by number when the error name is missing, and by name when only the name survives', () => {
    expect(
      classifyPlaybackFailure({ payload: { error: { errorCode: '22002' } }, url: STREAM_URL })
        .category,
    ).toBe('connection-timeout');
    expect(
      classifyPlaybackFailure({
        payload: { error: { errorString: 'ExoPlaybackException: ERROR_CODE_IO_FILE_NOT_FOUND' } },
        url: STREAM_URL,
      }).category,
    ).toBe('http-error');
  });

  it('reports the observed Star Sports failure without inventing a cause', () => {
    // The on-screen string the owner saw: `ERROR_CODE_IO_NETWORK_CONNECTION_FAILED (22001)`.
    const failure = classifyPlaybackFailure({
      payload: {
        error: {
          errorString: 'ExoPlaybackException: ERROR_CODE_IO_NETWORK_CONNECTION_FAILED',
          errorCode: '22001',
        },
      },
      url: 'https://cdn.example-live.invalid/real/star-sports-1/idx.m3u8',
    });
    expect(failure.code).toBe(2001);
    expect(failure.category).toBe('dns-or-unreachable');
    expect(failure.message).toContain('cdn.example-live.invalid');
    // The player could not connect; that is not evidence about DNS, so the sentence must not say
    // DNS, and it is not evidence about the user's own network either.
    expect(failure.message).not.toMatch(/DNS|resolve|your (internet )?connection|wi-?fi/i);
    // A first playback has no probe, so the app cannot know the host is down "right now".
    expect(failure.transient).toBe(false);
  });

  it('does not honour code names this library cannot produce', () => {
    // These three are what the task asked for and media3 1.11.1 does not define them. Reading them
    // anyway would mean guessing at a number that getErrorCodeName never prints.
    for (const name of [
      'ERROR_CODE_IO_PERMISSION_DENIED',
      'ERROR_CODE_DECODER_FAILED',
      'ERROR_CODE_EXTENSION_MISSING',
    ]) {
      const failure = classifyPlaybackFailure({ payload: exo(name, 9999), url: STREAM_URL });
      expect(failure.category).toBe('unknown');
      expect(failure.code).toBeNull();
    }
  });

  // Real media3 codes this app deliberately does not map: DRM (the live path has none, and
  // react-native-video recovers from those itself), offload audio, resources the OS reclaimed, a
  // byte-range error, and the player's own "something else". They must not be forced into a
  // category, and they are not silently dropped either — `livePlaybackDetail` still puts the code
  // on the screen for the report.
  it.each([
    ['ERROR_CODE_DRM_LICENSE_EXPIRED', 6008],
    ['ERROR_CODE_AUDIO_TRACK_OFFLOAD_WRITE_FAILED', 5003],
    ['ERROR_CODE_DECODING_RESOURCES_RECLAIMED', 4006],
    ['ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE', 2008],
    ['ERROR_CODE_UNSPECIFIED', 1000],
    ['ERROR_CODE_FAILED_RUNTIME_CHECK', 1004],
  ] as const)(
    'leaves the unmapped code %s (%i) as unknown rather than guessing',
    (name, code) => {
      const failure = classifyPlaybackFailure({ payload: exo(name, code), url: STREAM_URL });
      expect(failure.category).toBe('unknown');
      expect(failure.code).toBeNull();
      expect(failure.transient).toBe(false);
      expect(failure.message).toMatch(/code below/i);
    },
  );

  it('never reads react-native-video’s own four-digit codes as media3 codes', () => {
    // "3003" is what ReactExoplayerView emits for an unsupported DRM scheme; media3 uses 3003 for
    // PARSING_CONTAINER_UNSUPPORTED. The "2" prefix is the only thing that tells them apart.
    expect(
      classifyPlaybackFailure({ payload: { error: { errorCode: '3003' } }, url: STREAM_URL })
        .code,
    ).toBeNull();
  });
});

describe('classifyPlaybackFailure — transient is a property of the category', () => {
  it('is true for exactly the three categories a retry can plausibly fix', () => {
    const cases: ReadonlyArray<readonly [string, number, PlaybackFailureCategory]> = [
      ['ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', 2002, 'connection-timeout'],
      ['ERROR_CODE_TIMEOUT', 1003, 'connection-timeout'],
      ['ERROR_CODE_BEHIND_LIVE_WINDOW', 1002, 'stream-expired'],
    ];
    for (const [name, code, category] of cases) {
      const failure = classifyPlaybackFailure({ payload: exo(name, code), url: STREAM_URL });
      expect(failure.category).toBe(category);
      expect(failure.transient).toBe(true);
    }
    // A mid-stream drop is the third one, and only reaches that category once playback started.
    const dropped = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_UNSPECIFIED', 2000),
      url: STREAM_URL,
      playbackStarted: true,
    });
    expect(dropped.category).toBe('network-lost-mid-stream');
    expect(dropped.transient).toBe(true);

    for (const [name, code] of [
      ['ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001],
      ['ERROR_CODE_IO_BAD_HTTP_STATUS', 2004],
      ['ERROR_CODE_IO_FILE_NOT_FOUND', 2005],
      ['ERROR_CODE_IO_NO_PERMISSION', 2006],
      ['ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE', 2003],
      ['ERROR_CODE_PARSING_MANIFEST_MALFORMED', 3002],
      ['ERROR_CODE_DECODING_FORMAT_UNSUPPORTED', 4005],
    ] as const) {
      const failure = classifyPlaybackFailure({ payload: exo(name, code), url: STREAM_URL });
      expect(failure.transient).toBe(false);
    }
  });

  it('covers all nine categories, and only three of them are transient', () => {
    const rows: ReadonlyArray<{
      payload: PlayerErrorPayload;
      playbackStarted?: boolean;
      category: PlaybackFailureCategory;
      transient: boolean;
    }> = [
      { payload: exo('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001), category: 'dns-or-unreachable', transient: false },
      { payload: exo('ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', 2002), category: 'connection-timeout', transient: true },
      { payload: exo('ERROR_CODE_IO_FILE_NOT_FOUND', 2005), category: 'http-error', transient: false },
      { payload: exo('ERROR_CODE_DECODING_FORMAT_UNSUPPORTED', 4005), category: 'unsupported-format', transient: false },
      { payload: exo('ERROR_CODE_PARSING_MANIFEST_MALFORMED', 3002), category: 'invalid-manifest', transient: false },
      { payload: exo('ERROR_CODE_BEHIND_LIVE_WINDOW', 1002), category: 'stream-expired', transient: true },
      { payload: exo('ERROR_CODE_IO_NO_PERMISSION', 2006), category: 'access-rejected', transient: false },
      { payload: exo('ERROR_CODE_IO_UNSPECIFIED', 2000), playbackStarted: true, category: 'network-lost-mid-stream', transient: true },
      { payload: {}, category: 'unknown', transient: false },
    ];
    const categories = new Set<PlaybackFailureCategory>();
    for (const row of rows) {
      const failure = classifyPlaybackFailure({
        payload: row.payload,
        url: STREAM_URL,
        playbackStarted: row.playbackStarted,
      });
      expect(failure.category).toBe(row.category);
      expect(failure.transient).toBe(row.transient);
      categories.add(failure.category);
    }
    // Nothing in the agreed set is unreachable by the mapping, and nothing outside the three
    // retryable ones reports itself as retryable.
    expect(categories.size).toBe(9);
    expect(shouldRetry(classifyPlaybackFailure({ payload: {}, url: STREAM_URL }), 0)).toBe(false);
  });

  it('is still false for a refusal even when the probe shows the host answers', () => {
    const failure = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001),
      url: STREAM_URL,
      probe: probeOf({ observation: 'answered', status: 200, contentType: 'application/vnd.apple.mpegurl' }),
    });
    expect(failure.category).toBe('dns-or-unreachable');
    expect(failure.message).toContain('answers an ordinary request');
    expect(failure.transient).toBe(false);
  });
});

describe('classifyPlaybackFailure — dns-or-unreachable needs a signal', () => {
  it('names DNS only when the probe observed a resolution failure', () => {
    const failure = classifyPlaybackFailure({
      payload: { error: { errorString: 'ExoPlaybackException: ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', errorCode: '22001' } },
      url: STREAM_URL,
      probe: probeOf({ observation: 'host-did-not-resolve', detail: 'unknownhostexception' }),
    });
    expect(failure.category).toBe('dns-or-unreachable');
    expect(failure.message).toMatch(/does not resolve/i);
  });

  it('does not name DNS on a socket failure that said nothing about names', () => {
    const failure = classifyPlaybackFailure({
      payload: { error: { localizedDescription: 'Cannot start loading.' } },
      url: STREAM_URL,
      probe: probeOf({ observation: 'socket-could-not-open', detail: 'network request failed' }),
    });
    expect(failure.category).toBe('dns-or-unreachable');
    expect(failure.message).not.toMatch(/DNS|resolve/i);
  });

  it('reaches for DNS from the probe alone, never from silence', () => {
    for (const payload of [{}, { error: {} }, { error: { errorCode: '1001' } }] as PlayerErrorPayload[]) {
      const failure = classifyPlaybackFailure({ payload, url: STREAM_URL });
      expect(failure.category).toBe('unknown');
      expect(failure.category).not.toBe('dns-or-unreachable');
    }
  });
});

describe('classifyPlaybackFailure — context and probe sharpening', () => {
  it('tells "never opened" from "died under a running player" on media3\'s catch-all IO code', () => {
    const beforePlayback = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_UNSPECIFIED', 2000),
      url: STREAM_URL,
    });
    expect(beforePlayback.category).toBe('unknown');
    expect(beforePlayback.transient).toBe(false);

    const midStream = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_UNSPECIFIED', 2000),
      url: STREAM_URL,
      playbackStarted: true,
    });
    expect(midStream.category).toBe('network-lost-mid-stream');
    expect(midStream.transient).toBe(true);
  });

  it('uses the probe status to separate a refusal from a broken feed under BAD_HTTP_STATUS', () => {
    const refusal = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004),
      url: STREAM_URL,
      probe: probeOf({ observation: 'answered', status: 403 }),
    });
    expect(refusal.category).toBe('access-rejected');
    expect(refusal.message).toContain('403');

    const broken = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004),
      url: STREAM_URL,
      probe: probeOf({ observation: 'answered', status: 500 }),
    });
    expect(broken.category).toBe('http-error');
    expect(broken.message).toContain('500');

    const blind = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_BAD_HTTP_STATUS', 2004),
      url: STREAM_URL,
    });
    expect(blind.category).toBe('http-error');
    expect(blind.message).not.toMatch(/HTTP \d/);
  });

  it('treats a probe that timed out as a timeout, and a TLS failure as nothing more than itself', () => {
    expect(
      classifyPlaybackFailure({ payload: {}, url: STREAM_URL, probe: probeOf({ observation: 'timed-out', ms: 2500 }) })
        .category,
    ).toBe('connection-timeout');

    const tls = classifyPlaybackFailure({
      payload: {},
      url: STREAM_URL,
      probe: probeOf({ observation: 'tls-handshake-failed', detail: 'certificate' }),
    });
    // There is no TLS bucket in the agreed set and `access-rejected` would claim a decision the
    // handshake never got to make, so this stays `unknown` with a sentence that says what happened.
    expect(tls.category).toBe('unknown');
    expect(tls.message).toMatch(/handshake/i);
    expect(tls.transient).toBe(false);
  });

  it('never repeats the stream URL, which can carry an access token', () => {
    const failure = classifyPlaybackFailure({
      payload: exo('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001),
      url: 'https://cdn.example-live.invalid/real/star/token/SECRET-TOKEN.m3u8?sig=SECRET',
    });
    expect(failure.message).not.toContain('SECRET');
    expect(failure.message).not.toContain('/real/star');
  });
});

describe('classifyPlaybackFailure — empty payload', () => {
  it('yields unknown with a sentence that does not blame the user\'s connection', () => {
    for (const payload of [{}, { error: undefined }, { error: {} }, { error: { errorString: '   ' } }] as PlayerErrorPayload[]) {
      const failure = classifyPlaybackFailure({ payload });
      expect(failure.category).toBe('unknown');
      expect(failure.transient).toBe(false);
      expect(failure.code).toBeNull();
      expect(failure.codeName).toBeNull();
      expect(failure.host).toBeNull();
      expect(failure.message).toBeTruthy();
      expect(failure.message).not.toMatch(
        /your (internet )?connection|wi-?fi|check your network|network is down|DNS/i,
      );
    }
  });
});

describe('shouldRetry — the bounded automatic retry counter', () => {
  const transientFailure = classifyPlaybackFailure({
    payload: exo('ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT', 2002),
    url: STREAM_URL,
  });
  const stubbornFailure = classifyPlaybackFailure({
    payload: exo('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 2001),
    url: STREAM_URL,
  });

  it('is a transient category and an unused retry, both', () => {
    expect(transientFailure.transient).toBe(true);
    expect(shouldRetry(transientFailure, 0)).toBe(true);
    expect(shouldRetry(transientFailure, 1)).toBe(true);
    // Two automatic retries is the whole budget; the third question gets a button, not a loop.
    expect(shouldRetry(transientFailure, 2)).toBe(false);
    expect(shouldRetry(transientFailure, 99)).toBe(false);
  });

  it('never retries a failure that reproduces itself', () => {
    for (const name of [
      'ERROR_CODE_IO_NO_PERMISSION',
      'ERROR_CODE_IO_BAD_HTTP_STATUS',
      'ERROR_CODE_DECODING_FORMAT_UNSUPPORTED',
    ]) {
      const failure = classifyPlaybackFailure({
        payload: exo(name, 2006),
        url: STREAM_URL,
      });
      expect(failure.transient).toBe(false);
      expect(shouldRetry(failure, 0)).toBe(false);
    }
    expect(shouldRetry(stubbornFailure, 0)).toBe(false);
  });

  it('caps at the constant the screen shows the user', () => {
    expect(MAX_AUTOMATIC_LIVE_RETRIES).toBe(2);
    expect(shouldRetry(transientFailure, 0, 0)).toBe(false);
    expect(shouldRetry(transientFailure, 2, 3)).toBe(true);
  });
});

describe('the retry wording and schedule the screen shows', () => {
  it('counts up to the cap in words the owner asked for', () => {
    expect(automaticRetryNotice(1)).toBe('Retrying (1 of 2)…');
    expect(automaticRetryNotice(2)).toBe('Retrying (2 of 2)…');
    // Never "(3 of 2)": the notice is shown beside a counter that is capped by construction.
    expect(automaticRetryNotice(3)).toBe('Retrying (2 of 2)…');
  });

  it('waits longer between attempts, but only briefly', () => {
    expect(automaticRetryDelayMs(1)).toBeLessThan(automaticRetryDelayMs(2));
    expect(automaticRetryDelayMs(1)).toBeGreaterThan(0);
    expect(automaticRetryDelayMs(2)).toBeLessThanOrEqual(3000);
    expect(automaticRetryDelayMs(99)).toBe(automaticRetryDelayMs(2));
  });
});
