import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { buildHomeFeed, type HomeRowSpec } from '@/src/config/homeFeed';
import { fetchCategoryPage, type CategoryQuery } from '@/src/services/categories';
import {
  describeWave1Failures,
  fetchHomeWave1,
  posterFailureNotice,
  wave1IsBlocked,
  wave1Retryable,
} from '@/src/services/homeFeedFetch';
import { POSTER_FAILURE_THRESHOLD, subscribeImageHealth } from '@/src/utils/imageHealth';
import type { MediaItem } from '@/src/types';
import { getRegionName, useCatalogRegion } from '@/src/hooks/useCatalogRegion';

export interface HomeRow {
  id: string;
  title: string;
  data: MediaItem[];
  /** Category descriptor enabling a paginated "View More" screen. */
  query: CategoryQuery;
  variant: HomeRowSpec['variant'];
}

interface HomeDataContextValue {
  hero: MediaItem[];
  rows: HomeRow[];
  loading: boolean;
  /** Set only when nothing loaded at all — Home replaces the feed with a retry. */
  error: string | null;
  /**
   * A half-loaded feed says so here instead of hiding it: one section failing
   * used to be reported as a whole-feed error, and posters failing was silent.
   */
  notice: string | null;
  /** False when the failure was a missing/refused key: retrying repeats it. */
  canRetry: boolean;
  refreshing: boolean;
  /** Splash-blocking: regional popular movies + TV → hero + country Top 10s. */
  prefetch: () => Promise<void>;
  refresh: () => void;
}

const TOP_TEN_COUNT = 10;
const HERO_COUNT = 5;

const HomeDataContext = createContext<HomeDataContextValue>({
  hero: [],
  rows: [],
  loading: true,
  error: null,
  notice: null,
  canRetry: true,
  refreshing: false,
  prefetch: async () => {},
  refresh: () => {},
});

const assembleRows = (
  feed: HomeRowSpec[],
  filled: Map<string, HomeRow>,
): HomeRow[] =>
  feed.flatMap((spec) => {
    const row = filled.get(spec.id);
    return row && row.data.length > 0 ? [row] : [];
  });

const rowFromSpec = (spec: HomeRowSpec, data: MediaItem[]): HomeRow => ({
  id: spec.id,
  title: spec.title,
  data: spec.variant === 'topTen' ? data.slice(0, TOP_TEN_COUNT) : data,
  query: spec.query,
  variant: spec.variant,
});

export const HomeDataProvider = ({ children }: { children: ReactNode }) => {
  const { region } = useCatalogRegion();
  const feed = useMemo(
    () => buildHomeFeed(region, getRegionName(region)),
    [region],
  );
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const regionRef = useRef(region);
  regionRef.current = region;

  const [hero, setHero] = useState<MediaItem[]>([]);
  const [rows, setRows] = useState<HomeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contentNotice, setContentNotice] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(true);
  // Poster loads report through imageHealth (a failed <Image> never reaches this
  // hook), so content failures and CDN failures are combined into one honest line.
  const [failedPosters, setFailedPosters] = useState(0);

  useEffect(
    () => subscribeImageHealth((count) => setFailedPosters(count)),
    [],
  );

  const filledRef = useRef<Map<string, HomeRow>>(new Map());
  const wave1PromiseRef = useRef<Promise<void> | null>(null);
  const wave1DoneRef = useRef(false);
  const wave2GenerationRef = useRef(0);

  const notice = useMemo(() => {
    const parts = [
      contentNotice,
      posterFailureNotice(failedPosters, POSTER_FAILURE_THRESHOLD),
    ].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  }, [contentNotice, failedPosters]);

  const commitRows = useCallback(() => {
    setRows(assembleRows(feedRef.current, filledRef.current));
  }, []);

  const loadWave2 = useCallback(
    (generation: number) => {
      const specs = feedRef.current.filter((spec) => spec.wave === 2);
      for (const spec of specs) {
        void fetchCategoryPage(spec.query, 1)
          .then((data) => {
            if (generation !== wave2GenerationRef.current) return;
            if (!data.length) return;
            filledRef.current.set(spec.id, rowFromSpec(spec, data));
            commitRows();
          })
          .catch(() => {
            // Failed wave-2 rows are omitted; they must not fail the home feed.
          });
      }
    },
    [commitRows],
  );

  /**
   * Movies and TV are fetched independently, so one broken half of the feed can
   * no longer hide the other. Never throws: a blocked feed is reported through
   * `error` with the reason TMDB or the network actually gave.
   */
  const loadWave1 = useCallback(async (): Promise<boolean> => {
    const wave = await fetchHomeWave1(regionRef.current);
    const blocked = wave1IsBlocked(wave);
    const sentence = describeWave1Failures(wave.failures);

    setHero(wave.movies.slice(0, HERO_COUNT));

    const next = new Map<string, HomeRow>();
    for (const spec of feedRef.current) {
      if (spec.wave !== 1) continue;
      const data = spec.query.kind === 'popularTv' ? wave.tv : wave.movies;
      if (!data.length) continue;
      next.set(spec.id, rowFromSpec(spec, data));
    }
    filledRef.current = next;
    commitRows();

    setError(blocked ? (sentence ?? 'No titles are available right now.') : null);
    setContentNotice(blocked ? null : sentence);
    setCanRetry(wave1Retryable(wave.failures));
    return blocked;
  }, [commitRows]);

  const prefetch = useCallback(async () => {
    if (wave1DoneRef.current) return;
    if (wave1PromiseRef.current) return wave1PromiseRef.current;

    const run = (async () => {
      try {
        const blocked = await loadWave1();
        wave1DoneRef.current = true;
        // One attempt per session: the request layer already retried transient
        // failures, and a key or network that is simply absent will not fix
        // itself before the next explicit refresh.
        if (!blocked) {
          wave2GenerationRef.current += 1;
          loadWave2(wave2GenerationRef.current);
        }
      } finally {
        setLoading(false);
      }
    })();

    wave1PromiseRef.current = run;
    try {
      await run;
    } finally {
      wave1PromiseRef.current = null;
    }
  }, [loadWave1, loadWave2]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    wave1DoneRef.current = false;
    wave2GenerationRef.current += 1;
    void (async () => {
      try {
        const blocked = await loadWave1();
        wave1DoneRef.current = true;
        if (!blocked) loadWave2(wave2GenerationRef.current);
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    })();
  }, [loadWave1, loadWave2]);

  const value = useMemo(
    () => ({
      hero,
      rows,
      loading,
      error,
      notice,
      canRetry,
      refreshing,
      prefetch,
      refresh,
    }),
    [hero, rows, loading, error, notice, canRetry, refreshing, prefetch, refresh],
  );

  return (
    <HomeDataContext.Provider value={value}>{children}</HomeDataContext.Provider>
  );
};

export const useHomeData = (): HomeDataContextValue => useContext(HomeDataContext);
