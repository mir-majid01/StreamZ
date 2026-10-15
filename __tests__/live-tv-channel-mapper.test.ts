/**
 * The channel-mapping half of the Live TV wiring. Release 34 shipped the multi-source
 * engine but the runtime still read one playlist, so these assertions are the ones that
 * describe what the app actually shows: which sources are read, what a channel's id and
 * categories become, and whether saved favourites survive the rename.
 */

import {
  IPTV_ID_PREFIX,
  LEGACY_ID_PREFIX,
  PH_CATEGORY,
  migrateLegacyId,
  rankCategories,
  toLiveChannel,
} from '@/src/services/liveTv/liveChannelMapper';
import { resolveSources, LIVE_TV_PLAYLIST_SOURCES } from '@/src/services/liveTv/playlistSources';
import type { PlaylistEntry } from '@/src/services/liveTv/playlistParser';
import type { LiveChannel } from '@/src/services/DaddyLiveService';

const entry = (over: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  id: `${IPTV_ID_PREFIX}iptv-org:bbc-one`,
  name: 'BBC News Asia Pacific (720p)',
  streamUrl: 'https://cdn.example/live/bbc.m3u8',
  categories: ['News'],
  sourceIds: ['iptv-org'],
  ...over,
});

describe('playlist source list used at runtime', () => {
  it('reads both intended catalogues plus the built-in Philippine list', () => {
    const ids = resolveSources().map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['iptv-org', 'free-tv', 'ph']));
    expect(ids).toHaveLength(LIVE_TV_PLAYLIST_SOURCES.length + 1);
  });

  it('replaces only the Philippine entry when an override playlist is configured', () => {
    const sources = resolveSources('https://example.com/my.m3u');
    const ids = sources.map((s) => s.id);
    expect(ids).not.toContain('ph');
    expect(ids).toContain('custom');
    expect(sources.find((s) => s.id === 'custom')?.url).toBe('https://example.com/my.m3u');
    expect(ids).toContain('iptv-org');
  });
});

describe('toLiveChannel', () => {
  it('carries the playable URL, attribution and required headers through', () => {
    const channel = toLiveChannel(
      entry({
        logoUrl: 'https://logo.example/bbc.png',
        country: 'GB',
        headers: { 'User-Agent': 'StreamZ/1.0' },
      }),
    );
    expect(channel).toMatchObject({
      id: 'iptv:iptv-org:bbc-one',
      name: 'BBC News Asia Pacific (720p)',
      letter: 'B',
      streamUrl: 'https://cdn.example/live/bbc.m3u8',
      logoUrl: 'https://logo.example/bbc.png',
      country: 'GB',
      categories: ['News'],
      sourceIds: ['iptv-org'],
      headers: { 'User-Agent': 'StreamZ/1.0' },
      eventTitles: [],
    });
  });

  it('keeps the Philippine channels in the category their list was filed under', () => {
    expect(toLiveChannel(entry({ sourceIds: ['ph'] })).categories).toContain(PH_CATEGORY);
    expect(toLiveChannel(entry({ sourceIds: ['custom'] })).categories).toContain(PH_CATEGORY);
    expect(toLiveChannel(entry({ sourceIds: ['iptv-org'] })).categories).not.toContain(
      PH_CATEGORY,
    );
  });

  it('does not duplicate the category when the playlist already labels it', () => {
    const channel = toLiveChannel(
      entry({ sourceIds: ['ph'], categories: [PH_CATEGORY, 'News'] }),
    );
    expect(channel.categories).toEqual([PH_CATEGORY, 'News']);
  });
});

describe('rankCategories', () => {
  const channel = (name: string, categories: string[]): LiveChannel =>
    ({ id: `${IPTV_ID_PREFIX}${name}`, name, categories, eventTitles: [] }) as LiveChannel;

  it('leads with the categories that actually have channels', () => {
    const ranked = rankCategories([
      channel('a1', ['News']),
      channel('a2', ['News']),
      channel('a3', ['News', 'Sports']),
      channel('b1', ['Kids']),
      channel('b2', ['Kids']),
      channel('c1', ['Auto']),
    ]);
    expect(ranked.slice(0, 2)).toEqual(['News', 'Kids']);
    expect(ranked).toContain('Sports');
  });

  it('breaks ties alphabetically and caps the row', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      channel(`c${i}`, [`Cat${String(i).padStart(2, '0')}`]),
    );
    const ranked = rankCategories(many, 40);
    expect(ranked).toHaveLength(40);
    expect(ranked[0]).toBe('Cat00');
    expect(ranked).toEqual([...ranked].sort());
  });
});

describe('migrateLegacyId', () => {
  it('moves pre-merge favourites onto the new prefix instead of losing them', () => {
    const legacy = `${LEGACY_ID_PREFIX}bbc-news-asia-pacific-720p`;
    expect(migrateLegacyId(legacy)).toBe(`${IPTV_ID_PREFIX}ph:bbc-news-asia-pacific-720p`);
    expect(migrateLegacyId(legacy, 'custom')).toBe(
      `${IPTV_ID_PREFIX}custom:bbc-news-asia-pacific-720p`,
    );
  });

  it('leaves already-migrated and FlixQuest ids exactly as they are', () => {
    expect(migrateLegacyId(`${IPTV_ID_PREFIX}iptv-org:bbc-one`)).toBe(
      `${IPTV_ID_PREFIX}iptv-org:bbc-one`,
    );
    expect(migrateLegacyId('dlhd-2234')).toBe('dlhd-2234');
  });
});
