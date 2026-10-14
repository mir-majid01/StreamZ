/**
 * M3U/M3U8 playlist parsing and cross-source merging for Live TV.
 *
 * Deliberately free of React Native imports so the whole catalogue pipeline can be
 * unit-tested against real playlist text without a device.
 */

export interface PlaylistSource {
  /** Stable key baked into channel ids; changing it invalidates favourites. */
  id: string;
  /** Shown to the user as attribution. */
  label: string;
  url: string;
  homepage: string;
  license: string;
}

export interface PlaylistEntry {
  id: string;
  name: string;
  streamUrl: string;
  /** `tvg-id`, the identifier the source itself considers stable. */
  externalId?: string;
  logoUrl?: string;
  /** group-title split on ";": Free-TV writes `Animation;Kids` as one field. */
  categories: string[];
  country?: string;
  language?: string;
  headers?: Record<string, string>;
  /** Every source that listed this channel, after merging. */
  sourceIds: string[];
}

export interface MergeStats {
  perSource: Record<string, number>;
  duplicatesRemoved: number;
  total: number;
}

export interface MergedCatalogue {
  entries: PlaylistEntry[];
  stats: MergeStats;
}

/**
 * Only these survive the playlist → player hop. A playlist is untrusted input, so an
 * arbitrary `#EXTVLCOPT:http-*` directive must not be able to attach, say, an
 * `Authorization` header meant for another host to an outbound request.
 */
const HEADER_ALLOWLIST: Record<string, string> = {
  'http-user-agent': 'User-Agent',
  'http-referrer': 'Referer',
  'http-referer': 'Referer',
  'http-accept': 'Accept',
  'http-cookie': 'Cookie',
};

export const isVlcOpt = (line: string): string | null => {
  const m = line.match(/^#EXTVLCOPT:\s*([^=]+)=(.*)$/i);
  if (!m) return null;
  return m[1].trim().toLowerCase();
};

/**
 * Splits an `#EXTINF` line into its quoted attributes and its display name.
 *
 * The name is everything after the attribute block rather than "after the last comma",
 * because real channel names do contain commas (`BBC One, London`) and a naive split
 * silently truncates them.
 */
export function parseExtInf(line: string): { attrs: Record<string, string>; name: string } | null {
  const m = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)\s*(.*)$/i);
  if (!m) return null;
  const rest = m[2];

  const attrs: Record<string, string> = {};
  const pair = /([A-Za-z0-9_-]+)="([^"]*)"/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(rest))) {
    // Attributes are separated by whitespace only; the first gap that holds anything
    // else (the comma that opens the display name) ends the attribute block.
    if (rest.slice(cursor, match.index).trim() !== '') break;
    attrs[match[1].toLowerCase()] = match[2];
    cursor = match.index + match[0].length;
  }

  let name = rest.slice(cursor);
  name = name.replace(/^[\s,]+/, '').trim();
  return { attrs, name };
}

/**
 * iptv-org mints ids as `<channel>.<country>[@<quality>]` (`00sReplay.us@SD`); Free-TV
 * ships an explicit `tvg-country` and bare `.al`-style suffixes. Both are read from the
 * source's own metadata — nothing is inferred from the channel name's language.
 */
export function deriveCountry(
  explicit: string | undefined,
  externalId: string | undefined,
  name: string,
): string | undefined {
  const declared = explicit?.trim();
  if (declared) {
    // Real playlists write this three ways: "AL", "[AL]Albania", and "" (iptv-org's
    // empty tvg-alt-country). The bracketed code wins; otherwise the value is kept
    // as the source wrote it rather than guessed at.
    const bracketed = declared.match(/^\[([^\]]+)\]/);
    return (bracketed ? bracketed[1] : declared).toUpperCase();
  }
  const fromId = externalId?.match(/\.([a-z]{2,3})(?:@[\w-]+)?$/i)?.[1]?.toUpperCase();
  if (fromId) return fromId;
  return name.match(/\(([A-Za-z]{2})\)\s*$/)?.[1]?.toUpperCase();
}

export const normalizeName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[.\-_｜|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (value: string): string => {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'channel';
};

export function splitCategories(value: string): string[] {
  return [...new Set(value.split(';').map((s) => s.trim()).filter(Boolean))];
}

/** A response with neither a header nor a single entry is not a playlist we should trust. */
export function looksLikePlaylist(text: string): boolean {
  if (!text || text.length === 0) return false;
  return /^#EXTM3U/i.test(text) || /#EXTINF:/i.test(text);
}

/**
 * Parses one playlist. Entries missing a name or an absolute http(s) URL are dropped —
 * there is nothing playable to show for them, and keeping them would advertise a channel
 * that can only ever fail.
 */
export function parsePlaylist(text: string, source: PlaylistSource): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  const lines = text.split(/\r?\n/);
  const usedIds = new Set<string>();

  let pending: { attrs: Record<string, string>; name: string } | null = null;
  let pendingGroup: string | null = null;
  let pendingHeaders: Record<string, string> = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (/^#EXTM3U/i.test(line)) continue;

    const extinf = parseExtInf(line);
    if (extinf) {
      pending = extinf;
      pendingGroup = null;
      pendingHeaders = {};
      continue;
    }

    const grp = line.match(/^#EXTGRP:(.*)$/i);
    if (grp) {
      pendingGroup = grp[1].trim() || null;
      continue;
    }

    const vlcOpt = isVlcOpt(line);
    if (vlcOpt) {
      const mapped = HEADER_ALLOWLIST[vlcOpt];
      const value = line.slice(line.indexOf('=') + 1).trim();
      if (mapped && value) pendingHeaders = { ...pendingHeaders, [mapped]: value };
      continue;
    }

    if (line.startsWith('#')) continue; // any other directive: ignored, not fatal

    if (!pending) continue;

    let url: URL;
    try {
      url = new URL(line);
    } catch {
      pending = null;
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      pending = null;
      continue;
    }

    const name = pending.name;
    const externalId = pending.attrs['tvg-id'] || undefined;
    const categories = splitCategories(pending.attrs['group-title'] || pendingGroup || '');
    const logo = pending.attrs['tvg-logo'] || undefined;
    const language = pending.attrs['tvg-language'] || undefined;
    const attrsUserAgent = pending.attrs['http-user-agent'];
    const attrsReferrer = pending.attrs['http-referrer'] || pending.attrs['http-referer'];
    const headers = {
      ...pendingHeaders,
      ...(attrsUserAgent ? { 'User-Agent': attrsUserAgent } : {}),
      ...(attrsReferrer ? { Referer: attrsReferrer } : {}),
    };

    if (name) {
      let id = `iptv:${source.id}:${externalId ? slugify(externalId) : slugify(name)}`;
      let n = 2;
      while (usedIds.has(id)) id = `iptv:${source.id}:${(externalId ? slugify(externalId) : slugify(name))}-${n++}`;
      usedIds.add(id);
      entries.push({
        id,
        name,
        streamUrl: url.href,
        externalId,
        logoUrl: logo || undefined,
        categories,
        country: deriveCountry(pending.attrs['tvg-country'], externalId, name),
        language,
        headers: Object.keys(headers).length ? headers : undefined,
        sourceIds: [source.id],
      });
    }

    pending = null;
  }

  return entries;
}

/**
 * Merge priority: the source's own stable id, then the exact stream URL, then an
 * equal normalized name. Later matches enrich the first entry instead of replacing it,
 * so a channel that has a logo in one playlist and a category in the other keeps both.
 */
export function mergePlaylists(results: { sourceId: string; entries: PlaylistEntry[] }[]): MergedCatalogue {
  const byExternalId = new Map<string, PlaylistEntry>();
  const byUrl = new Map<string, PlaylistEntry>();
  const byName = new Map<string, PlaylistEntry>();
  const out: PlaylistEntry[] = [];
  const perSource: Record<string, number> = {};
  let duplicatesRemoved = 0;

  for (const { sourceId, entries } of results) {
    perSource[sourceId] = (perSource[sourceId] ?? 0) + entries.length;
    for (const entry of entries) {
      const existing =
        (entry.externalId ? byExternalId.get(entry.externalId.toLowerCase()) : undefined) ??
        byUrl.get(entry.streamUrl) ??
        byName.get(normalizeName(entry.name));

      if (existing) {
        duplicatesRemoved += 1;
        if (!existing.logoUrl && entry.logoUrl) existing.logoUrl = entry.logoUrl;
        for (const c of entry.categories) if (!existing.categories.includes(c)) existing.categories.push(c);
        if (!existing.country && entry.country) existing.country = entry.country;
        if (!existing.language && entry.language) existing.language = entry.language;
        if (!existing.headers && entry.headers) existing.headers = entry.headers;
        if (!existing.externalId && entry.externalId) existing.externalId = entry.externalId;
        if (!existing.sourceIds.includes(sourceId)) existing.sourceIds.push(sourceId);
        continue;
      }

      out.push(entry);
      if (!entry.sourceIds.includes(sourceId)) entry.sourceIds.push(sourceId);
      if (entry.externalId) byExternalId.set(entry.externalId.toLowerCase(), entry);
      byUrl.set(entry.streamUrl, entry);
      byName.set(normalizeName(entry.name), entry);
    }
  }

  return { entries: out, stats: { perSource, duplicatesRemoved, total: out.length } };
}

export interface CatalogueFacets {
  categories: string[];
  countries: string[];
  languages: string[];
}

/** Facets are built from what the playlists actually carry, never from a fixed list. */
export function buildFacets(entries: PlaylistEntry[]): CatalogueFacets {
  const categories = new Set<string>();
  const countries = new Set<string>();
  const languages = new Set<string>();
  for (const entry of entries) {
    for (const c of entry.categories) categories.add(c);
    if (entry.country) countries.add(entry.country);
    if (entry.language) languages.add(entry.language);
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { categories: sort(categories), countries: sort(countries), languages: sort(languages) };
}
