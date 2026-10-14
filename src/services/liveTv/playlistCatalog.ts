import {
  buildFacets,
  looksLikePlaylist,
  mergePlaylists,
  parsePlaylist,
  type CatalogueFacets,
  type MergedCatalogue,
  type PlaylistEntry,
  type PlaylistSource,
} from './playlistParser';

export type FailureReason = 'network' | 'http' | 'malformed' | 'empty' | 'no-cache';

export type SourceOutcome =
  | { sourceId: string; state: 'fresh'; fetchedAt: number; entries: PlaylistEntry[] }
  | { sourceId: string; state: 'cached'; fetchedAt: number; entries: PlaylistEntry[]; reason: FailureReason }
  | { sourceId: string; state: 'unavailable'; fetchedAt: null; entries: []; reason: FailureReason };

export interface PlaylistCatalogue {
  entries: PlaylistEntry[];
  facets: CatalogueFacets;
  stats: MergedCatalogue['stats'];
  outcomes: SourceOutcome[];
}

/** Anything the app persists through; tests pass an in-memory one. */
export interface TextStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

export interface FetchLike {
  (url: string, init?: { signal?: AbortSignal }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface CatalogueOptions {
  fetch: FetchLike;
  store: TextStore;
  now?: () => number;
  timeoutMs?: number;
  /** Total tries per source, including the first. Bounded on purpose. */
  attempts?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const cacheKey = (sourceId: string): string => `liveTv.playlist.${sourceId}`;

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class TimeoutError extends Error {}

/**
 * Bounds the whole exchange — request *and* body read. Passing `signal` alone is not
 * enough: a host that sends headers then stalls in the body keeps the promise open, and
 * a hung catalogue fetch on the way to the Live tab is exactly the failure the user
 * would experience as "the app is frozen".
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([work, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Fetches one playlist with a timeout and a bounded number of tries. A non-2xx and a
 * thrown error are reported apart because "the host is down" and "the host answered with
 * an error page" need different follow-up, and both differ from "playback failed".
 */
export async function fetchPlaylistText(
  source: PlaylistSource,
  opts: Pick<CatalogueOptions, 'fetch' | 'timeoutMs' | 'attempts' | 'backoffMs' | 'sleep'>,
): Promise<{ ok: true; text: string } | { ok: false; reason: FailureReason; status?: number }> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const sleep = opts.sleep ?? defaultSleep;
  let last: { ok: false; reason: FailureReason; status?: number } = { ok: false, reason: 'network' };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    type Attempt = { kind: 'body'; body: string } | { kind: 'status'; status: number };
    try {
      const work: Promise<Attempt> = opts
        .fetch(source.url, { signal: controller.signal })
        .then((res) =>
          res.ok
            ? res.text().then<Attempt>((body) => ({ kind: 'body', body }))
            : Promise.resolve<Attempt>({ kind: 'status', status: res.status }),
        );
      const res = await withTimeout(work, timeoutMs);
      if (res.kind === 'status') {
        last = { ok: false, reason: 'http', status: res.status };
        // A 404 will not fix itself on retry; stop early and keep the cached catalogue.
        if (res.status === 404 || res.status === 410) return last;
      } else {
        if (!looksLikePlaylist(res.body)) return { ok: false, reason: 'malformed' };
        return { ok: true, text: res.body };
      }
    } catch {
      last = { ok: false, reason: 'network' };
      controller.abort();
    }
    if (attempt < attempts) await sleep((opts.backoffMs ?? 1000) * attempt);
  }
  return last;
}

const readCache = async (
  store: TextStore,
  sourceId: string,
): Promise<{ fetchedAt: number; entries: PlaylistEntry[] } | null> => {
  try {
    const raw = await store.read(cacheKey(sourceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt?: number; entries?: PlaylistEntry[] };
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return null;
    if (typeof parsed.fetchedAt !== 'number') return null;
    return { fetchedAt: parsed.fetchedAt, entries: parsed.entries };
  } catch {
    return null;
  }
};

/**
 * Refreshes every source and merges the results.
 *
 * The rule that matters: a source only ever contributes *fetched* entries or its
 * *previously cached* entries. A failed fetch, a truncated upload, an HTML error page or
 * an empty playlist therefore cannot shrink the user's channel list, and nothing is
 * written over a good cache.
 */
export async function loadPlaylistCatalogue(
  sources: PlaylistSource[],
  opts: CatalogueOptions,
): Promise<PlaylistCatalogue> {
  const now = opts.now?.() ?? Date.now();
  const outcomes: SourceOutcome[] = [];

  for (const source of sources) {
    const fetched = await fetchPlaylistText(source, opts);
    if (fetched.ok) {
      const entries = parsePlaylist(fetched.text, source);
      if (entries.length > 0) {
        try {
          await opts.store.write(cacheKey(source.id), JSON.stringify({ fetchedAt: now, entries }));
        } catch {
          // A cache write failure costs us persistence, not the channels we just parsed.
        }
        outcomes.push({ sourceId: source.id, state: 'fresh', fetchedAt: now, entries });
        continue;
      }
    }
    const reason = fetched.ok ? 'empty' : fetched.reason;
    const cached = await readCache(opts.store, source.id);
    outcomes.push(
      cached
        ? { sourceId: source.id, state: 'cached', fetchedAt: cached.fetchedAt, entries: cached.entries, reason }
        : { sourceId: source.id, state: 'unavailable', fetchedAt: null, entries: [], reason: cached ? reason : 'no-cache' },
    );
  }

  const merged = mergePlaylists(outcomes.map((o) => ({ sourceId: o.sourceId, entries: o.entries })));
  return {
    entries: merged.entries,
    facets: buildFacets(merged.entries),
    stats: merged.stats,
    outcomes,
  };
}
