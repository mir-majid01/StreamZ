import {
  cacheKey,
  fetchPlaylistText,
  loadPlaylistCatalogue,
  type FetchLike,
  type TextStore,
} from '@/src/services/liveTv/playlistCatalog';
import type { PlaylistSource } from '@/src/services/liveTv/playlistParser';

const A: PlaylistSource = { id: 'a', label: 'A', url: 'https://a/plt.m3u', homepage: 'https://a', license: 'x' };
const B: PlaylistSource = { id: 'b', label: 'B', url: 'https://b/plt.m3u8', homepage: 'https://b', license: 'y' };

const playlist = (name: string, url: string, id = name) =>
  `#EXTM3U\n#EXTINF:-1 tvg-id="${id}" group-title="News",${name}\n${url}\n`;

const memoryStore = (initial: Record<string, string> = {}): TextStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    async read(key) { return data[key] ?? null; },
    async write(key, value) { data[key] = value; },
  };
};

const responder = (
  handler: (url: string, call: number) => { ok: boolean; status: number; body?: string } | { throws: true },
): { fetch: FetchLike; calls: string[] } => {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const n = (counts.get(url) ?? 0) + 1;
    counts.set(url, n);
    const result = handler(url, n);
    if ('throws' in result) throw new Error('network down');
    return {
      ok: result.ok,
      status: result.status,
      text: async () => result.body ?? '',
    };
  };
  return { fetch, calls };
};

const opts = (fetch: FetchLike, store: TextStore) => ({
  fetch,
  store,
  now: () => 1_700_000_000_000,
  sleep: async () => {},
});

describe('fetchPlaylistText', () => {
  it('returns the body of a valid playlist', async () => {
    const { fetch } = responder(() => ({ ok: true, status: 200, body: playlist('A', 'https://s/a') }));
    const res = await fetchPlaylistText(A, { fetch, sleep: async () => {} });
    expect(res.ok).toBe(true);
  });

  it('retries a failing host up to the attempt limit and reports network', async () => {
    const { fetch, calls } = responder(() => ({ throws: true }));
    const res = await fetchPlaylistText(A, { fetch, attempts: 3, sleep: async () => {} });
    expect(res).toEqual({ ok: false, reason: 'network' });
    expect(calls).toHaveLength(3);
  });

  it('stops early on 404 instead of hammering the host', async () => {
    const { fetch, calls } = responder(() => ({ ok: false, status: 404 }));
    const res = await fetchPlaylistText(A, { fetch, attempts: 3, sleep: async () => {} });
    expect(res).toEqual({ ok: false, reason: 'http', status: 404 });
    expect(calls).toHaveLength(1);
  });

  it('refuses an HTML error page served with a 200', async () => {
    const { fetch } = responder(() => ({ ok: true, status: 200, body: '<html>Oops</html>' }));
    const res = await fetchPlaylistText(A, { fetch, sleep: async () => {} });
    expect(res).toEqual({ ok: false, reason: 'malformed' });
  });

  it('aborts a request that outlives the timeout', async () => {
    let sawSignal = false;
    const fetch: FetchLike = async (_url, init) => {
      sawSignal = Boolean(init?.signal);
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, status: 200, text: async () => playlist('x', 'https://s/x') };
    };
    const res = await fetchPlaylistText(A, { fetch, timeoutMs: 5, attempts: 1, sleep: async () => {} });
    expect(sawSignal).toBe(true);
    expect(res).toEqual({ ok: false, reason: 'network' });
  });
});

describe('loadPlaylistCatalogue', () => {
  it('caches a successful source and merges across sources', async () => {
    const store = memoryStore();
    const { fetch } = responder((url) =>
      url === A.url
        ? { ok: true, status: 200, body: playlist('Alpha', 'https://s/1', 'Alpha.a') }
        : { ok: true, status: 200, body: playlist('Bravo', 'https://s/2', 'Bravo.b') },
    );
    const out = await loadPlaylistCatalogue([A, B], opts(fetch, store));
    expect(out.entries.map((e) => e.name)).toEqual(['Alpha', 'Bravo']);
    expect(out.outcomes.map((o) => o.state)).toEqual(['fresh', 'fresh']);
    expect(JSON.parse(store.data[cacheKey('a')]).entries).toHaveLength(1);
  });

  it('keeps the cached catalogue when the host is down', async () => {
    const cached = JSON.stringify({ fetchedAt: 1, entries: [
      { id: 'iptv:a:old', name: 'Old Channel', streamUrl: 'https://s/old', categories: ['News'], sourceIds: ['a'] },
    ] });
    const store = memoryStore({ [cacheKey('a')]: cached });
    const { fetch } = responder(() => ({ throws: true }));
    const out = await loadPlaylistCatalogue([A], opts(fetch, store));
    expect(out.entries.map((e) => e.name)).toEqual(['Old Channel']);
    expect(out.outcomes[0]).toMatchObject({ state: 'cached', reason: 'network', fetchedAt: 1 });
  });

  it('never writes an empty or malformed response over a good cache', async () => {
    const cached = JSON.stringify({ fetchedAt: 1, entries: [
      { id: 'iptv:a:old', name: 'Old Channel', streamUrl: 'https://s/old', categories: [], sourceIds: ['a'] },
    ] });
    const store = memoryStore({ [cacheKey('a')]: cached });
    const { fetch } = responder(() => ({ ok: true, status: 200, body: '#EXTM3U\n' }));
    const out = await loadPlaylistCatalogue([A], opts(fetch, store));
    expect(out.outcomes[0]).toMatchObject({ state: 'cached', reason: 'empty' });
    expect(store.data[cacheKey('a')]).toBe(cached);
  });

  it('reports a source unavailable when it fails with nothing cached, and still serves the other', async () => {
    const store = memoryStore();
    const { fetch } = responder((url) =>
      url === A.url ? { throws: true } : { ok: true, status: 200, body: playlist('Bravo', 'https://s/2') },
    );
    const out = await loadPlaylistCatalogue([A, B], opts(fetch, store));
    expect(out.outcomes[0]).toMatchObject({ state: 'unavailable', reason: 'no-cache' });
    expect(out.outcomes[1]).toMatchObject({ state: 'fresh' });
    expect(out.entries.map((e) => e.name)).toEqual(['Bravo']);
  });

  it('treats corrupt cache JSON as missing rather than throwing', async () => {
    const store = memoryStore({ [cacheKey('a')]: '{not json' });
    const { fetch } = responder(() => ({ throws: true }));
    const out = await loadPlaylistCatalogue([A], opts(fetch, store));
    expect(out.outcomes[0]).toMatchObject({ state: 'unavailable', reason: 'no-cache' });
    expect(out.entries).toEqual([]);
  });

  it('counts duplicates removed across sources', async () => {
    const store = memoryStore();
    const { fetch } = responder(() => ({ ok: true, status: 200, body: playlist('Same', 'https://s/1', 'Same.x') }));
    const out = await loadPlaylistCatalogue([A, B], opts(fetch, store));
    expect(out.stats.total).toBe(1);
    expect(out.stats.duplicatesRemoved).toBe(1);
    expect(out.entries[0].sourceIds).toEqual(['a', 'b']);
    expect(out.facets.categories).toEqual(['News']);
  });
});
