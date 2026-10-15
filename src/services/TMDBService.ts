import { TMDB_CONFIG } from '@/src/config/env';
import {
  ContentRatingsResponse,
  CreditsResponse,
  ExternalIdsResponse,
  Genre,
  MediaImagesResponse,
  MediaItem,
  Movie,
  MovieDetails,
  ReleaseDatesResponse,
  SeasonDetails,
  TmdbImage,
  TMDBResponse,
  TVShow,
  TVShowDetails,
  VideoResponse,
} from '@/src/types';

type QueryParams = Record<string, string | number | boolean | undefined>;

/** Abort a request if the network stalls, so the UI never hangs forever. */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Shorter deadline for replays. The first attempt is patient because the splash
 * screen waits on it; a retry that also stalls for 15 s would push a black-holed
 * connection (captive portal, blocked route) past the point where any user waits.
 */
const RETRY_TIMEOUT_MS = 6000;

/**
 * Waits before replaying a request that failed for a reason that can plausibly
 * fix itself. Two attempts, because the user is watching a spinner: enough to
 * ride out a reset socket or a single 500, short enough to fail honestly.
 */
const RETRY_DELAYS_MS = [300, 900];

/**
 * Why a TMDB call failed, in terms the UI can act on. A key that never worked,
 * a server that said no, and a phone with no signal all looked identical before
 * this existed — and each needs a different sentence shown to the user.
 */
export type TMDBErrorKind =
  /** This build cannot ask TMDB for anything (no key, unusable base URL). */
  | 'config'
  /** TMDB refused the credentials in the build (401/403). */
  | 'auth'
  /** TMDB throttled us (429). */
  | 'rateLimit'
  /** A well-formed HTTP answer that was not an ok one, or not JSON at all. */
  | 'http'
  /** The request never completed: offline, DNS, reset, blocked. */
  | 'network'
  /** We aborted our own request after REQUEST_TIMEOUT_MS. */
  | 'timeout';

export class TMDBError extends Error {
  readonly kind: TMDBErrorKind;
  readonly status?: number;
  /**
   * Endpoint path only — never the query string, which carries `api_key`. Used
   * for diagnostics so a failure can be named without printing a secret.
   */
  readonly path?: string;
  /** False when replaying the request cannot help: a bad key stays bad. */
  readonly retryable: boolean;

  constructor(
    message: string,
    kind: TMDBErrorKind,
    detail: { status?: number; path?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'TMDBError';
    this.kind = kind;
    this.status = detail.status;
    this.path = detail.path;
    this.retryable =
      detail.retryable ??
      (kind === 'network' ||
        kind === 'timeout' ||
        kind === 'rateLimit' ||
        (kind === 'http' && (detail.status ?? 0) >= 500));
  }
}

/** The part of a TMDB error the user can read, with the key removed if it ever appeared. */
const sanitize = (text: string, apiKey: string): string =>
  apiKey ? text.replaceAll(apiKey, '[api key]') : text;

/**
 * Checked before any request is built, so a keyless build says so instead of
 * relaying a 401 that reads like a blocked network. Extracted (and exported)
 * because the condition is a property of the build, not of one call site.
 */
export const missingKeyError = (apiKey: string, path: string): TMDBError | null =>
  apiKey
    ? null
    : new TMDBError(
        'No TMDB API key is configured. Set EXPO_PUBLIC_TMDB_API_KEY and rebuild — ' +
          'EXPO_PUBLIC_* values are inlined into the bundle at build time.',
        'config',
        { path, retryable: false },
      );

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Thin TMDB client built on the native fetch API (no axios).
 */
class TMDBServiceImpl {
  private readonly baseUrl = TMDB_CONFIG.BASE_URL;
  private readonly apiKey = TMDB_CONFIG.API_KEY;

  private async request<T>(path: string, params: QueryParams = {}): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.attemptOnce<T>(
          path,
          params,
          attempt === 0 ? REQUEST_TIMEOUT_MS : RETRY_TIMEOUT_MS,
        );
      } catch (err) {
        if (!(err instanceof TMDBError) || !err.retryable) throw err;
        if (attempt >= RETRY_DELAYS_MS.length) throw err;
        await sleep(RETRY_DELAYS_MS[attempt++]);
      }
    }
  }

  private async attemptOnce<T>(
    path: string,
    params: QueryParams,
    timeoutMs: number,
  ): Promise<T> {
    const missing = missingKeyError(this.apiKey, path);
    if (missing) throw missing;

    // The API key is a query parameter, so the assembled URL must never reach an
    // error message, a log, or an Error cause — a leaked URL is a leaked key.
    let url: URL;
    try {
      url = new URL(`${this.baseUrl}${path}`);
    } catch {
      // Not a secret: naming the configured base URL is the only way the owner
      // can tell a typo in the environment from a failure in the app.
      throw new TMDBError(
        `EXPO_PUBLIC_TMDB_BASE_URL is not a valid URL ("${this.baseUrl}"). Fix it and rebuild.`,
        'config',
        { path, retryable: false },
      );
    }
    url.searchParams.set('api_key', this.apiKey);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new TMDBError(
          'Request timed out. TMDB may be blocked on your network — try another connection or a VPN.',
          'timeout',
          { path },
        );
      }
      throw new TMDBError(
        'Network request failed. Check your connection, then try again.',
        'network',
        { path },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // TMDB's own status_message ("Invalid api key provided", "The service is
      // currently unavailable") is the difference between "your key is bad" and
      // "your wifi is down", so read it when the body allows it.
      const detail = await this.statusMessage(response);
      const kind: TMDBErrorKind =
        response.status === 401 || response.status === 403
          ? 'auth'
          : response.status === 429
            ? 'rateLimit'
            : 'http';
      throw new TMDBError(
        kind === 'auth'
          ? `TMDB rejected this build's API key (${response.status}). ${detail ?? 'The key is missing, wrong, or not valid for this endpoint.'}`
          : kind === 'rateLimit'
            ? `TMDB is rate-limiting this device (429). ${detail ?? 'Try again in a moment.'}`
            : `TMDB returned an error (${response.status}). ${detail ?? 'Try again shortly.'}`,
        kind,
        { status: response.status, path },
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      // A captive portal or a proxy that answers HTML reaches this line: the
      // status was fine, the body was not JSON. Saying so beats a raw
      // SyntaxError that looks like a bug in the app.
      throw new TMDBError(
        'TMDB replied with something that is not JSON — a captive portal or proxy may be intercepting requests on this network.',
        'http',
        { status: response.status, path, retryable: false },
      );
    }
  }

  /** TMDB's human-readable reason for a non-ok response, key-redacted, or null. */
  private async statusMessage(response: Response): Promise<string | null> {
    try {
      const body = (await response.json()) as { status_message?: unknown };
      const message = body?.status_message;
      if (typeof message !== 'string' || !message.trim()) return null;
      return sanitize(message.trim(), this.apiKey);
    } catch {
      return null;
    }
  }

  getImageUrl(
    path: string | null | undefined,
    size: 'w185' | 'w200' | 'w300' | 'w500' | 'w780' | 'original' = 'w500',
  ): string {
    if (!path) return '';
    return `https://image.tmdb.org/t/p/${size}${path}`;
  }

  // ── Trending / discover ──────────────────────────────────────────────
  getTrendingMovies(page = 1) {
    return this.request<TMDBResponse<Movie>>('/trending/movie/week', { page });
  }

  getTrendingTVShows(page = 1) {
    return this.request<TMDBResponse<TVShow>>('/trending/tv/week', { page });
  }

  getPopularMovies(page = 1, region?: string) {
    return this.request<TMDBResponse<Movie>>('/movie/popular', {
      page,
      region,
    });
  }

  getPopularTVShows(page = 1, region?: string) {
    return this.request<TMDBResponse<TVShow>>('/tv/popular', {
      page,
      region,
    });
  }

  getTopRatedMovies(page = 1) {
    return this.request<TMDBResponse<Movie>>('/movie/top_rated', { page });
  }

  discoverMoviesByGenre(genreId: number, page = 1, region?: string) {
    return this.request<TMDBResponse<Movie>>('/discover/movie', {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      page,
      region,
      watch_region: region,
    });
  }

  discoverTVByGenre(genreId: number, page = 1, region?: string) {
    return this.request<TMDBResponse<TVShow>>('/discover/tv', {
      with_genres: genreId,
      sort_by: 'popularity.desc',
      page,
      region,
      watch_region: region,
    });
  }

  discoverByWatchProvider(
    media: 'movie' | 'tv',
    providerId: number,
    page = 1,
    region = 'US',
  ) {
    const path = media === 'movie' ? '/discover/movie' : '/discover/tv';
    return this.request<TMDBResponse<Movie | TVShow>>(path, {
      with_watch_providers: providerId,
      watch_region: region,
      region,
      with_watch_monetization_types: 'flatrate',
      sort_by: 'popularity.desc',
      page,
    });
  }

  // ── Search ───────────────────────────────────────────────────────────
  async searchMulti(query: string, page = 1): Promise<TMDBResponse<MediaItem>> {
    const data = await this.request<TMDBResponse<MediaItem>>('/search/multi', {
      query,
      page,
      include_adult: false,
    });
    // Keep only movies and tv shows (drop person results).
    return {
      ...data,
      results: data.results.filter(
        (item) => item.media_type === 'movie' || item.media_type === 'tv',
      ),
    };
  }

  // ── Details ──────────────────────────────────────────────────────────
  getMovieDetails(id: number) {
    return this.request<MovieDetails>(`/movie/${id}`);
  }

  getTVShowDetails(id: number) {
    return this.request<TVShowDetails>(`/tv/${id}`);
  }

  getMovieVideos(id: number) {
    return this.request<VideoResponse>(`/movie/${id}/videos`);
  }

  getTVShowVideos(id: number) {
    return this.request<VideoResponse>(`/tv/${id}/videos`);
  }

  getMovieCredits(id: number) {
    return this.request<CreditsResponse>(`/movie/${id}/credits`);
  }

  getTVShowCredits(id: number) {
    return this.request<CreditsResponse>(`/tv/${id}/credits`);
  }

  getSimilarMovies(id: number, page = 1) {
    return this.request<TMDBResponse<Movie>>(`/movie/${id}/similar`, { page });
  }

  getSimilarTVShows(id: number, page = 1) {
    return this.request<TMDBResponse<TVShow>>(`/tv/${id}/similar`, { page });
  }

  getSeasonDetails(tvId: number, seasonNumber: number) {
    return this.request<SeasonDetails>(`/tv/${tvId}/season/${seasonNumber}`);
  }

  /** IMDb (+ other) external ids for a movie — used to fill a playback
   * server's `{imdbId}` URL placeholder, see `streamUrl.ts`. */
  getMovieExternalIds(id: number) {
    return this.request<ExternalIdsResponse>(`/movie/${id}/external_ids`);
  }

  /** IMDb (+ other) external ids for a TV show — see `getMovieExternalIds`. */
  getTVExternalIds(id: number) {
    return this.request<ExternalIdsResponse>(`/tv/${id}/external_ids`);
  }

  getMovieGenres() {
    return this.request<{ genres: Genre[] }>('/genre/movie/list');
  }

  getTVGenres() {
    return this.request<{ genres: Genre[] }>('/genre/tv/list');
  }

  getMovieReleaseDates(id: number) {
    return this.request<ReleaseDatesResponse>(`/movie/${id}/release_dates`);
  }

  getTVContentRatings(id: number) {
    return this.request<ContentRatingsResponse>(`/tv/${id}/content_ratings`);
  }

  getMovieImages(id: number) {
    return this.request<MediaImagesResponse>(`/movie/${id}/images`, {
      include_image_language: 'en,null',
    });
  }

  getTVImages(id: number) {
    return this.request<MediaImagesResponse>(`/tv/${id}/images`, {
      include_image_language: 'en,null',
    });
  }

  /** Prefer English logo, then null-language, then highest-voted. */
  pickLogoPath(logos: TmdbImage[] | undefined): string | null {
    if (!logos?.length) return null;
    const scored = [...logos].sort((a, b) => {
      const langScore = (img: TmdbImage) =>
        img.iso_639_1 === 'en' ? 2 : img.iso_639_1 == null ? 1 : 0;
      const langDiff = langScore(b) - langScore(a);
      if (langDiff !== 0) return langDiff;
      return (b.vote_average ?? 0) - (a.vote_average ?? 0);
    });
    return scored[0]?.file_path ?? null;
  }

  /** Best-effort US (or first available) certification string. */
  async getCertification(
    id: number,
    mediaType: 'movie' | 'tv',
  ): Promise<string | null> {
    try {
      if (mediaType === 'movie') {
        const data = await this.getMovieReleaseDates(id);
        const us = data.results.find((r) => r.iso_3166_1 === 'US');
        const pool = us ?? data.results[0];
        const cert = pool?.release_dates.find((d) => d.certification)?.certification;
        return cert || null;
      }
      const data = await this.getTVContentRatings(id);
      const us = data.results.find((r) => r.iso_3166_1 === 'US');
      return us?.rating || data.results[0]?.rating || null;
    } catch {
      return null;
    }
  }
}

export const TMDBService = new TMDBServiceImpl();

/** First official YouTube trailer/teaser key from a videos response. */
export const pickTrailerKey = (videos: VideoResponse | undefined): string | null => {
  if (!videos?.results?.length) return null;
  const youtube = videos.results.filter((v) => v.site === 'YouTube');
  const trailer =
    youtube.find((v) => v.type === 'Trailer' && v.official) ??
    youtube.find((v) => v.type === 'Trailer') ??
    youtube.find((v) => v.type === 'Teaser') ??
    youtube[0];
  return trailer?.key ?? null;
};
