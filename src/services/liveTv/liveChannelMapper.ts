import type { LiveChannel } from '@/src/services/DaddyLiveService';
import type { PlaylistEntry } from './playlistParser';

/**
 * Turns merged playlist entries into the channel shape the Live tab and the player
 * already consume. Kept free of React Native imports so the mapping — the part that
 * decides ids, categories and headers — is testable without a device.
 */

/** Prefix for every playlist channel. `getStream` routes on it. */
export const IPTV_ID_PREFIX = 'iptv:';

/** The prefix playlist channels carried before the multi-source engine existed. */
export const LEGACY_ID_PREFIX = 'm3u:';

/**
 * The category the built-in Philippine playlist was filed under, kept so an existing
 * user's browsing and favourites land where they left them.
 */
export const PH_CATEGORY = 'PH';

/** Source ids whose channels belonged to that playlist (the second is an env override). */
const PH_SOURCE_IDS = new Set(['ph', 'custom']);

/**
 * How many category chips the Live tab is given. The merged catalogues carry 124
 * categories between them — a list to search, not a row to scroll — so the biggest
 * ones lead. Every channel stays reachable: its category filter is only a shortcut
 * for the name search, and the entry itself is always in the list.
 */
export const MAX_CATEGORY_CHIPS = 40;

export const toLiveChannel = (entry: PlaylistEntry): LiveChannel => {
  const fromPhList = entry.sourceIds.some((id) => PH_SOURCE_IDS.has(id));
  const categories = [...new Set([...entry.categories, ...(fromPhList ? [PH_CATEGORY] : [])])];
  return {
    id: entry.id,
    name: entry.name,
    letter: entry.name.match(/[A-Za-z0-9]/)?.[0]?.toUpperCase(),
    streamUrl: entry.streamUrl,
    categories,
    eventTitles: [],
    logoUrl: entry.logoUrl,
    country: entry.country,
    language: entry.language,
    sourceIds: entry.sourceIds,
    headers: entry.headers,
  };
};

/**
 * Categories ordered by how many channels they actually contain, then alphabetically,
 * capped at `limit`. Derived from the catalogue rather than a fixed list, so a source
 * that disappears takes its categories with it instead of leaving empty chips.
 */
export const rankCategories = (channels: LiveChannel[], limit = MAX_CATEGORY_CHIPS): string[] => {
  const counts = new Map<string, number>();
  for (const channel of channels) {
    for (const category of channel.categories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
};

/**
 * Rebuilds a saved id from the pre-merge scheme. The Philippine list carries no
 * `tvg-id`, so its new id is the same slug under a new prefix — which makes old
 * favourites and recents portable. Ids that cannot be mapped are returned as they
 * are and simply stop matching, rather than pointing at an unrelated channel.
 */
export const migrateLegacyId = (id: string, phSourceId = 'ph'): string => {
  if (!id.startsWith(LEGACY_ID_PREFIX) || id.startsWith(IPTV_ID_PREFIX)) return id;
  return `${IPTV_ID_PREFIX}${phSourceId}:${id.slice(LEGACY_ID_PREFIX.length)}`;
};
