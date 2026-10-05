import { getTitle, isMovie, type MediaItem } from '@/src/types';
import type { ContentIdentity } from '@/src/firebase/models';

/**
 * Identity of what the player was handed. Read-only over metadata the app already holds:
 * it never asks a resolver or a scraper for anything, and the ids it produces are stable
 * for a given TMDB title, which is what makes the admin's per-title totals meaningful.
 */
export const contentIdentityFor = (
  item: MediaItem | null | undefined,
  season?: number | null,
  episode?: number | null,
): ContentIdentity | null => {
  if (!item || typeof item.id !== 'number') return null;
  const title = getTitle(item) ?? `Untitled ${item.id}`;

  // A TV show played with an episode coordinate is recorded as that episode, not as the
  // series: one aggregated "series" row would hide which episodes people actually finish.
  if (!isMovie(item) && typeof season === 'number' && typeof episode === 'number') {
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      contentId: `tmdb:${item.id}:s${pad(season)}e${pad(episode)}`,
      contentTitle: `${title} S${pad(season)}E${pad(episode)}`,
      contentType: 'episode',
    };
  }

  return {
    contentId: `tmdb:${item.id}`,
    contentTitle: title,
    contentType: isMovie(item) ? 'movie' : 'series',
  };
};
