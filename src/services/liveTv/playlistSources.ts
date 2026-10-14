import type { PlaylistSource } from './playlistParser';

/**
 * Community-maintained catalogues StreamZ reads. These are directories of links, not
 * content hosts: every entry still comes from whoever published the stream, and neither
 * project guarantees that a given URL is authorized, live, or reachable from the user's
 * region. `license` is recorded here so attribution can be shown and audited.
 */
export const LIVE_TV_PLAYLIST_SOURCES: PlaylistSource[] = [
  {
    id: 'iptv-org',
    label: 'IPTV Org',
    url: 'https://iptv-org.github.io/iptv/index.m3u',
    homepage: 'https://github.com/iptv-org/iptv',
    // Public-domain dedication, so redistribution of the catalogue itself is unencumbered.
    license: 'Unlicense',
  },
  {
    id: 'free-tv',
    label: 'Free TV',
    url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
    homepage: 'https://github.com/Free-TV/IPTV',
    // No license file is detected on the repository, so only the link list is used and the
    // project is attributed by name.
    license: 'No license file detected',
  },
];

/**
 * The playlist that shipped with StreamZ before these two were added. Kept as a source
 * rather than replaced, because its Philippine channels and the category label existing
 * users saw are part of the current behaviour.
 */
export const LEGACY_PH_SOURCE: PlaylistSource = {
  id: 'ph',
  label: 'PH playlist',
  url: 'https://raw.githubusercontent.com/Harleythetech/IPHTV/main/ph.m3u',
  homepage: 'https://github.com/Harleythetech/IPHTV',
  license: 'Unspecified',
};

/**
 * A single URL override stays honoured: `EXPO_PUBLIC_LIVE_TV_M3U_URL` either replaces the
 * legacy list (when set, it becomes the only custom-playlist source) or is ignored.
 */
export function resolveSources(overrideUrl?: string): PlaylistSource[] {
  const ph = overrideUrl?.trim()
    ? [{ ...LEGACY_PH_SOURCE, url: overrideUrl.trim(), id: 'custom' }]
    : [LEGACY_PH_SOURCE];
  return [...ph, ...LIVE_TV_PLAYLIST_SOURCES];
}

export const sourceById = (id: string): PlaylistSource | undefined =>
  [...LIVE_TV_PLAYLIST_SOURCES, LEGACY_PH_SOURCE].find((s) => s.id === id);
