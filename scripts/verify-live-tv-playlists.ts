// Scratch verifier: runs the shipped Live TV path against the live playlists from this
// machine — the real source list, real parser, real merge, real channel mapping — then
// probes a few streams over HTTP. The cache and failure behaviour of that same path is
// covered by __tests__/live-tv-playlist-catalog.test.ts, which needs no network.
import {
  buildFacets,
  mergePlaylists,
  parsePlaylist,
} from '../src/services/liveTv/playlistParser.ts';
import { resolveSources } from '../src/services/liveTv/playlistSources.ts';
import {
  IPTV_ID_PREFIX,
  rankCategories,
  toLiveChannel,
} from '../src/services/liveTv/liveChannelMapper.ts';
import type { PlaylistSource, PlaylistEntry } from '../src/services/liveTv/playlistParser.ts';
import type { LiveChannel } from '../src/services/DaddyLiveService.ts';

const grab = async (url: string, attempt = 1): Promise<string> => {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'streamz-verify/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return grab(url, attempt + 1);
  }
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const sources: PlaylistSource[] = resolveSources();
console.log('sources:', sources.map((s) => `${s.id} = ${s.url}`).join('\n          '));

const results: { sourceId: string; entries: PlaylistEntry[] }[] = [];
for (const source of sources) {
  try {
    const text = await grab(source.url);
    const entries = parsePlaylist(text, source);
    results.push({ sourceId: source.id, entries });
    console.log(`${source.id}: ${text.length} bytes -> ${entries.length} entries`);
  } catch (e) {
    results.push({ sourceId: source.id, entries: [] });
    console.log(`${source.id}: UNAVAILABLE (${message(e)}) — the app would serve its cached copy`);
  }
}

const merged = mergePlaylists(results);
const channels = merged.entries.map(toLiveChannel);
const facets = buildFacets(merged.entries);
const chips = rankCategories(channels);
const count = (fn: (c: LiveChannel) => boolean) => channels.filter(fn).length;

console.log(
  JSON.stringify(
    {
      perSource: merged.stats.perSource,
      totalUnique: merged.stats.total,
      duplicatesRemoved: merged.stats.duplicatesRemoved,
      withLogo: count((c) => !!c.logoUrl),
      withCategory: count((c) => c.categories.length > 0),
      withCountry: count((c) => !!c.country),
      withLanguage: count((c) => !!c.language),
      withHeaders: count((c) => !!c.headers),
      categoriesAvailable: facets.categories.length,
      categoryChipsShown: chips.length,
      topChips: chips.slice(0, 10),
      countries: facets.countries.length,
      phChannels: channels
        .filter((c) => (c.sourceIds ?? []).includes('ph'))
        .map((c) => c.name),
    },
    null,
    1,
  ),
);

const ids = new Set(channels.map((c) => c.id));
const hasSources = (c: LiveChannel, id: string) => (c.sourceIds ?? []).includes(id);
console.log(
  'invariants:',
  'uniqueIds=' + (ids.size === channels.length),
  'allHttp=' + channels.every((c) => !!c.streamUrl && /^https?:\/\//.test(c.streamUrl)),
  'allAttributed=' + channels.every((c) => (c.sourceIds ?? []).length >= 1),
  'allCategorised=' + channels.every((c) => c.categories.length > 0),
  'iptvPrefix=' + channels.every((c) => c.id.startsWith(IPTV_ID_PREFIX)),
);

/**
 * Transport reachability only. A 200/206 with an HLS or MP4 body proves the URL is live
 * and not blocked *from this machine*; it is not evidence that the phone's decoder plays
 * it, which needs the device.
 */
const samples = [
  channels.find((c) => hasSources(c, 'ph')),
  channels.find((c) => hasSources(c, 'iptv-org') && c.headers),
  channels.find((c) => hasSources(c, 'free-tv')),
  channels.find((c) => !!c.streamUrl && /\.m3u8$/i.test(c.streamUrl) && !c.headers),
  channels.find((c) => !!c.streamUrl && /\.(mpd|mp4$)/i.test(c.streamUrl)),
].filter((c): c is LiveChannel & { streamUrl: string } => !!c?.streamUrl);

for (const channel of samples) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(channel.streamUrl, {
      headers: { ...(channel.headers ?? {}), Range: 'bytes=0-4096' },
      signal: controller.signal,
    });
    const bytes = (await res.arrayBuffer()).byteLength;
    console.log(
      `probe ${res.status} ${bytes}B ${res.headers.get('content-type') ?? '-'} :: ${channel.name} [${channel.sourceIds}]`,
    );
  } catch (e) {
    console.log(`probe FAILED ${e instanceof Error ? e.name : String(e)} :: ${channel.name} [${channel.sourceIds}]`);
  } finally {
    clearTimeout(timer);
  }
}
