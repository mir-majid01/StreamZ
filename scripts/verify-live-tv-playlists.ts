// Scratch: runs the committed parser against the live playlists using the real code path.
import {
  buildFacets,
  mergePlaylists,
  parsePlaylist,
} from '../src/services/liveTv/playlistParser.ts';

const SOURCES = [
  { id: 'iptv-org', label: 'IPTV Org', url: 'https://iptv-org.github.io/iptv/index.m3u', homepage: 'https://github.com/iptv-org/iptv', license: 'Unlicense' },
  { id: 'free-tv', label: 'Free TV', url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8', homepage: 'https://github.com/Free-TV/IPTV', license: 'unspecified' },
];

const grab = async (url, attempt = 1) => {
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

const results = [];
for (const source of SOURCES) {
  const text = await grab(source.url);
  const entries = parsePlaylist(text, source);
  results.push({ sourceId: source.id, entries });
  console.log(`${source.id}: ${text.length} bytes -> ${entries.length} parsed entries`);
}

const merged = mergePlaylists(results);
const facets = buildFacets(merged.entries);
const count = (fn) => merged.entries.filter(fn).length;

const firstMulti = merged.entries.find((e) => e.categories.length > 1);
console.log('MULTI_CATEGORY_SAMPLE', JSON.stringify(firstMulti && { name: firstMulti.name, categories: firstMulti.categories }));
console.log(JSON.stringify({
  perSource: merged.stats.perSource,
  duplicatesRemoved: merged.stats.duplicatesRemoved,
  totalUnique: merged.stats.total,
  withLogo: count((e) => e.logoUrl),
  withCategory: count((e) => e.categories.length),
  withCountry: count((e) => e.country),
  withLanguage: count((e) => e.language),
  withHeaders: count((e) => e.headers),
  categories: facets.categories.length,
  countries: facets.countries.length,
  languages: facets.languages.length,
  sampleCountries: facets.countries.slice(0, 12),
  sampleCategories: facets.categories.slice(0, 12),
}, null, 1));

const ids = new Set(merged.entries.map((e) => e.id));
console.log('invariants:',
  'uniqueIds=' + (ids.size === merged.entries.length),
  'allHttp=' + merged.entries.every((e) => /^https?:\/\//.test(e.streamUrl)),
  'allAttributed=' + merged.entries.every((e) => e.sourceIds.length >= 1));
