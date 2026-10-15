import { TMDBError, TMDBService, type TMDBErrorKind } from '@/src/services/TMDBService';
import { tagMedia } from '@/src/services/categories';
import type { MediaItem, Movie, TVShow, TMDBResponse } from '@/src/types';

/**
 * The two requests that gate the Home screen. They are deliberately independent:
 * a TV-only outage used to blank out the movies that arrived fine, because a
 * single `Promise.all` turned either rejection into a whole-feed failure.
 */
export type HomeSection = 'movies' | 'tv';

export interface HomeSectionFailure {
  section: HomeSection;
  kind: TMDBErrorKind | 'unknown';
  /** Safe to show: either a classified TMDB sentence or a fixed generic one. */
  message: string;
  /** False when pressing Retry would just fail again in the same way. */
  retryable: boolean;
}

export interface HomeWave1 {
  movies: MediaItem[];
  tv: MediaItem[];
  failures: HomeSectionFailure[];
}

const SECTION_LABEL: Record<HomeSection, string> = {
  movies: 'Movies',
  tv: 'TV shows',
};

type Wave1Deps = Record<HomeSection, () => Promise<MediaItem[]>>;

const defaultDeps = (region: string, page: number): Wave1Deps => ({
  movies: async () => {
    const res: TMDBResponse<Movie> = await TMDBService.getPopularMovies(page, region);
    return tagMedia(res.results, 'movie');
  },
  tv: async () => {
    const res: TMDBResponse<TVShow> = await TMDBService.getPopularTVShows(page, region);
    return tagMedia(res.results, 'tv');
  },
});

const toFailure = (section: HomeSection, err: unknown): HomeSectionFailure => {
  if (err instanceof TMDBError) {
    return { section, kind: err.kind, message: err.message, retryable: err.retryable };
  }
  // An unclassified throw is a bug, not a network state. Its message could be
  // anything — including a string that carries the request URL and the API key —
  // so it is dropped and the section is simply reported as failed.
  return {
    section,
    kind: 'unknown',
    message: `${SECTION_LABEL[section]} could not be loaded due to an unexpected error.`,
    retryable: false,
  };
};

const loadSection = async (
  section: HomeSection,
  run: () => Promise<MediaItem[]>,
): Promise<{ items: MediaItem[]; failure: HomeSectionFailure | null }> => {
  try {
    return { items: await run(), failure: null };
  } catch (err) {
    return { items: [], failure: toFailure(section, err) };
  }
};

/**
 * Fetches popular movies and popular TV concurrently and never rejects: the
 * result always carries whatever arrived, plus one entry per failed section.
 */
export const fetchHomeWave1 = async (
  region: string,
  page = 1,
  deps?: Wave1Deps,
): Promise<HomeWave1> => {
  const runners = deps ?? defaultDeps(region, page);
  const [movies, tv] = await Promise.all([
    loadSection('movies', runners.movies),
    loadSection('tv', runners.tv),
  ]);
  const failures = [movies.failure, tv.failure].filter(
    (f): f is HomeSectionFailure => f !== null,
  );
  return { movies: movies.items, tv: tv.items, failures };
};

/** Non-null only when neither section produced anything — Home has no content. */
export const wave1IsBlocked = (wave: HomeWave1): boolean =>
  wave.movies.length === 0 && wave.tv.length === 0;

/**
 * One sentence for the screen. Two sections failing from one cause (no key, no
 * network) is a single diagnosis, not two; mixed causes are listed per section
 * so the user can see which half of the feed they are missing.
 */
export const describeWave1Failures = (failures: HomeSectionFailure[]): string | null => {
  if (failures.length === 0) return null;
  if (failures.length === 1) {
    const [only] = failures;
    return `${SECTION_LABEL[only.section]} didn't load — ${only.message}`;
  }
  const kinds = new Set(failures.map((f) => f.kind));
  if (kinds.size === 1) return failures[0].message;
  return failures.map((f) => `${SECTION_LABEL[f.section]}: ${f.message}`).join(' ');
};

/**
 * Whether a retry could possibly help. False only when every failure is one that
 * reproduces itself — a key that is not in the build, or credentials TMDB
 * refused — so the screen can stop offering a button that fails again.
 */
export const wave1Retryable = (failures: HomeSectionFailure[]): boolean =>
  failures.every((f) => f.retryable);

/**
 * Wording kept here so the screen and the test agree on what was actually
 * measured: the feed loaded, so only the artwork is missing.
 */
export const POSTER_FAILURE_NOTICE =
  'Poster images are not loading — the image CDN may be blocked on this network. Titles and playback are unaffected.';

/** Null until enough posters have failed to be a pattern rather than one missing file. */
export const posterFailureNotice = (
  failedPosters: number,
  threshold: number,
): string | null => (failedPosters >= threshold ? POSTER_FAILURE_NOTICE : null);
