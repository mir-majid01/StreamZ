/**
 * Regression cover for the CI-34 Home failures: one dead section must not blank
 * the live one, and the message the user sees has to name the layer that broke
 * (build config, credentials, HTTP, network, or the image CDN) without ever
 * quoting the request URL, which carries the API key.
 */

jest.mock('@/src/config/env', () => {
  const actual = jest.requireActual('@/src/config/env');
  return {
    ...actual,
    TMDB_CONFIG: { ...actual.TMDB_CONFIG, API_KEY: 'unit-test-tmdb-key' },
  };
});

import { missingKeyError, TMDBError, TMDBService } from '@/src/services/TMDBService';
import {
  describeWave1Failures,
  fetchHomeWave1,
  posterFailureNotice,
  wave1IsBlocked,
  wave1Retryable,
  POSTER_FAILURE_NOTICE,
  type HomeSectionFailure,
} from '@/src/services/homeFeedFetch';
import { reportImageFailure, subscribeImageHealth } from '@/src/utils/imageHealth';
import type { MediaItem } from '@/src/types';

const MOVIES: MediaItem[] = [{ id: 1, media_type: 'movie' }] as unknown as MediaItem[];
const SHOWS: MediaItem[] = [{ id: 2, media_type: 'tv' }] as unknown as MediaItem[];

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

const page = (title: string) => ({ results: [{ id: 7, title }] });

let fetchMock: jest.Mock;
const originalFetch = (globalThis as { fetch?: unknown }).fetch;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
});

afterEach(() => {
  (globalThis as { fetch?: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('TMDB request classification', () => {
  it('refuses to build a request when this release has no key', () => {
    const missing = missingKeyError('', '/movie/popular');
    expect(missing).toMatchObject({ kind: 'config', retryable: false, path: '/movie/popular' });
    expect(missing!.message).toContain('EXPO_PUBLIC_TMDB_API_KEY');
    expect(missingKeyError('a-key', '/movie/popular')).toBeNull();
  });

  it('names a refused key as an auth failure and never retries it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ status_code: 16, status_message: 'Invalid api key provided: ' }, 401),
    );
    const err = await TMDBService.getPopularMovies(1, 'US').catch((e) => e);
    expect(err).toBeInstanceOf(TMDBError);
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/rejected this build's API key \(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure and reports it once the retries are spent', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));
    const err = await TMDBService.getPopularTVShows(1, 'US').catch((e) => e);
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
    // First attempt plus the two bounded retries.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('succeeds when a retry recovers the request', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(jsonResponse(page('Fake Movie')));
    await expect(TMDBService.getPopularMovies(1, 'US')).resolves.toMatchObject({
      results: [{ id: 7 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a 429 as retryable throttling, not an outage', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status_message: 'Too many requests' }, 429));
    const err = await TMDBService.getPopularMovies(1, 'US').catch((e) => e);
    expect(err.kind).toBe('rateLimit');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/rate-limiting/);
  });

  it('calls a non-JSON ok response an interception, not a bad title list', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);
    const err = await TMDBService.getPopularMovies(1, 'US').catch((e) => e);
    expect(err.kind).toBe('http');
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/not JSON/);
  });

  it('redacts the key even when TMDB echoes it back', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { status_message: 'Invalid api key provided: unit-test-tmdb-key' },
        401,
      ),
    );
    const err = await TMDBService.getPopularMovies(1, 'US').catch((e) => e);
    expect(err.message).not.toContain('unit-test-tmdb-key');
    expect(err.message).toContain('[api key]');
  });

  it('never puts the request URL in an error message', async () => {
    fetchMock.mockRejectedValue(new Error('Connection was reset'));
    const err = await TMDBService.getPopularMovies(1, 'US').catch((e) => e);
    expect(err.message).not.toContain('api_key');
    expect(err.message).not.toContain('themoviedb.org');
    expect(err.path).toBe('/movie/popular');
  });
});

describe('fetchHomeWave1 independence', () => {
  it('keeps the movies that loaded when only TV fails', async () => {
    const tvFailure = new TMDBError('Network request failed.', 'network', { path: '/tv/popular' });
    const wave = await fetchHomeWave1('US', 1, {
      movies: async () => MOVIES,
      tv: async () => {
        throw tvFailure;
      },
    });

    expect(wave.movies).toEqual(MOVIES);
    expect(wave.tv).toEqual([]);
    expect(wave.failures).toHaveLength(1);
    expect(wave.failures[0]).toMatchObject({ section: 'tv', kind: 'network' });
    expect(wave1IsBlocked(wave)).toBe(false);
    expect(describeWave1Failures(wave.failures)).toMatch(/^TV shows didn't load/);
  });

  it('keeps the TV shows that loaded when only movies fails', async () => {
    const wave = await fetchHomeWave1('US', 1, {
      movies: async () => {
        throw new TMDBError('TMDB is rate-limiting this device (429).', 'rateLimit');
      },
      tv: async () => SHOWS,
    });
    expect(wave.tv).toEqual(SHOWS);
    expect(wave1IsBlocked(wave)).toBe(false);
    expect(describeWave1Failures(wave.failures)).toMatch(/^Movies didn't load/);
  });

  it('blocks the feed only when neither section returns anything', async () => {
    const wave = await fetchHomeWave1('US', 1, {
      movies: async () => {
        throw new TMDBError('No TMDB API key is configured.', 'config', { retryable: false });
      },
      tv: async () => {
        throw new TMDBError('No TMDB API key is configured.', 'config', { retryable: false });
      },
    });
    expect(wave1IsBlocked(wave)).toBe(true);
    // Both halves died of the same cause, so say it once.
    expect(describeWave1Failures(wave.failures)).toBe('No TMDB API key is configured.');
    expect(wave1Retryable(wave.failures)).toBe(false);
  });

  it('lists mixed causes per section', async () => {
    const wave = await fetchHomeWave1('US', 1, {
      movies: async () => {
        throw new TMDBError('auth failed', 'auth', { retryable: false });
      },
      tv: async () => {
        throw new TMDBError('network failed', 'network');
      },
    });
    const text = describeWave1Failures(wave.failures) ?? '';
    expect(text).toContain('Movies: auth failed');
    expect(text).toContain('TV shows: network failed');
    expect(wave1Retryable(wave.failures)).toBe(false);
  });

  it('drops the message of an unclassified throw instead of risking a leak', async () => {
    const wave = await fetchHomeWave1('US', 1, {
      movies: async () => {
        throw new TypeError(
          'Failed to fetch https://api.themoviedb.org/3/movie/popular?api_key=SECRET123',
        );
      },
      tv: async () => SHOWS,
    });
    const [failure] = wave.failures;
    expect(failure.kind).toBe('unknown');
    expect(failure.retryable).toBe(false);
    expect(failure.message).not.toContain('api_key');
    expect(failure.message).not.toContain('SECRET123');
    expect(failure.message).not.toContain('themoviedb.org');
  });
});

describe('failure wording for retry decisions', () => {
  const failure = (over: Partial<HomeSectionFailure>): HomeSectionFailure => ({
    section: 'movies',
    kind: 'network',
    message: 'Network request failed.',
    retryable: true,
    ...over,
  });

  it('offers a retry when nothing failed or when the cause can pass', () => {
    expect(wave1Retryable([])).toBe(true);
    expect(wave1Retryable([failure({})])).toBe(true);
    expect(wave1Retryable([failure({ kind: 'timeout' })])).toBe(true);
  });

  it('withholds a retry when the cause reproduces itself', () => {
    expect(wave1Retryable([failure({ kind: 'config', retryable: false })])).toBe(false);
    expect(
      wave1Retryable([failure({ kind: 'auth', retryable: false }), failure({})]),
    ).toBe(false);
    expect(describeWave1Failures([])).toBeNull();
  });
});

describe('poster (image CDN) health signal', () => {
  it('stays quiet until enough posters have failed to be an outage', () => {
    expect(posterFailureNotice(0, 3)).toBeNull();
    expect(posterFailureNotice(2, 3)).toBeNull();
    expect(posterFailureNotice(3, 3)).toBe(POSTER_FAILURE_NOTICE);
  });

  it('counts each reported failure and stops after unsubscribing', () => {
    let seen = -1;
    const unsubscribe = subscribeImageHealth((count) => {
      seen = count;
    });
    const baseline = seen;
    reportImageFailure();
    reportImageFailure();
    expect(seen).toBe(baseline + 2);
    unsubscribe();
    reportImageFailure();
    expect(seen).toBe(baseline + 2);
  });
});
