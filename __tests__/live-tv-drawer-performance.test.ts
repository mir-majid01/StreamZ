/**
 * The Live TV lists that used to be built by walking the whole merged catalogue.
 *
 * The player's channel drawer rendered all ~12.5k entries as direct children of one
 * ScrollView, and the schedule looked a channel up with `Array.prototype.find` per row.
 * Both turn on the same two facts, and both are asserted here: an id-keyed lookup that
 * resolves exactly what the scan did, and a catalogue the player can read without the
 * whole array riding in its navigation params.
 */

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  appendUniqueChannels,
  buildChannelIndex,
  resolveScheduleChannel,
} from '@/src/services/liveTv/channelIndex';
import {
  DaddyLiveService,
  type LiveChannel,
  type LiveEpgChannel,
} from '@/src/services/DaddyLiveService';
import { LIVE_TV_M3U_CONFIG } from '@/src/config/env';
import { resolveSources } from '@/src/services/liveTv/playlistSources';

const channel = (over: Partial<LiveChannel> = {}): LiveChannel => ({
  id: 'iptv:iptv-org:bbc-one',
  name: 'BBC News',
  categories: ['News'],
  eventTitles: [],
  ...over,
});

const epgRef = (over: Partial<LiveEpgChannel> = {}): LiveEpgChannel => ({
  id: 'iptv:iptv-org:bbc-one',
  name: 'BBC News',
  ...over,
});

/** What the schedule did before the index existed: a scan, with a literal fallback. */
const findAsTheScheduleUsedTo = (
  channels: LiveChannel[],
  reference: LiveEpgChannel,
): LiveChannel =>
  channels.find((c) => c.id === reference.id) ?? {
    id: reference.id,
    name: reference.name,
    categories: [],
    eventTitles: [],
  };

describe('buildChannelIndex', () => {
  it('resolves every id the catalogue carries', () => {
    const channels = [
      channel({ id: 'a', name: 'One' }),
      channel({ id: 'b', name: 'Two' }),
      channel({ id: 'c', name: 'Three' }),
    ];
    const index = buildChannelIndex(channels);
    expect(index.get('b')).toBe(channels[1]);
    expect(index.size).toBe(3);
  });

  it('keeps the first of a repeated id, the way the scan it replaced did', () => {
    const first = channel({ id: 'a', name: 'First' });
    const second = channel({ id: 'a', name: 'Second' });
    const index = buildChannelIndex([first, second]);
    expect(index.get('a')).toBe(first);
    expect(resolveScheduleChannel(index, epgRef({ id: 'a' }))).toBe(first);
  });

  it('agrees with the old linear scan on every entry of a larger catalogue', () => {
    const channels = Array.from({ length: 2000 }, (_, i) =>
      channel({ id: `iptv:iptv-org:ch-${i}`, name: `Channel ${i}` }),
    );
    const index = buildChannelIndex(channels);
    const references = [
      ...channels.map((c) => epgRef({ id: c.id, name: c.name })),
      epgRef({ id: 'not-in-the-catalogue', name: 'A source that dropped out' }),
      epgRef({ id: '', name: '' }),
    ];
    for (const reference of references) {
      expect(resolveScheduleChannel(index, reference)).toEqual(
        findAsTheScheduleUsedTo(channels, reference),
      );
    }
  });
});

describe('resolveScheduleChannel', () => {
  it('falls back to the EPG reference with empty arrays when the catalogue lacks it', () => {
    const index = buildChannelIndex([channel({ id: 'a' })]);
    expect(
      resolveScheduleChannel(index, epgRef({ id: 'missing', name: 'Some Channel' })),
    ).toEqual({
      id: 'missing',
      name: 'Some Channel',
      categories: [],
      eventTitles: [],
    });
  });

  it('does not mutate the index or reuse the fallback object between calls', () => {
    const index = buildChannelIndex([channel({ id: 'a' })]);
    const first = resolveScheduleChannel(index, epgRef({ id: 'z', name: 'Z' }));
    const second = resolveScheduleChannel(index, epgRef({ id: 'z', name: 'Z' }));
    expect(first).not.toBe(second);
    expect(index.size).toBe(1);
  });
});

describe('appendUniqueChannels', () => {
  it('appends only the ids the list does not already have', () => {
    const existing = [channel({ id: 'a' }), channel({ id: 'b' })];
    const incoming = [channel({ id: 'b' }), channel({ id: 'c' })];
    const merged = appendUniqueChannels(existing, incoming);
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1]).toBe(existing[1]);
  });

  it('leaves a list with no new ids alone, so a drawer key cannot collide', () => {
    const existing = [channel({ id: 'a' }), channel({ id: 'b' })];
    const merged = appendUniqueChannels(existing, existing);
    expect(merged).toEqual(existing);
    expect(new Set(merged.map((c) => c.id)).size).toBe(merged.length);
  });

  it('takes the whole incoming list when nothing is loaded yet', () => {
    const incoming = [channel({ id: 'a' })];
    expect(appendUniqueChannels([], incoming)).toEqual(incoming);
  });
});

describe('DaddyLiveService.getPlaylistCatalogue', () => {
  const SOURCES = resolveSources(LIVE_TV_M3U_CONFIG.overrideUrl);

  const playlist = (label: string, count: number) =>
    [
      '#EXTM3U',
      ...Array.from({ length: count }, (_, i) =>
        [
          `#EXTINF:-1 tvg-id="${label}-${i}" group-title="News",${label} ${i}`,
          `https://cdn.example/${label}/${i}.m3u8`,
        ].join('\n'),
      ),
    ].join('\n');

  beforeAll(() => {
    const bodies = new Map(SOURCES.map((source) => [source.url, playlist(source.id, 4)]));
    const fetchImpl = jest.fn(async (input: unknown) => {
      const url = String(input);
      const body = bodies.get(url);
      return {
        ok: body != null,
        status: body != null ? 200 : 404,
        text: async () => body ?? '',
        json: async () => JSON.parse(body ?? '{}'),
      };
    });
    (globalThis as { fetch: unknown }).fetch = fetchImpl;
  });

  afterAll(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  it('returns an empty list, never a null, before anything has loaded', () => {
    expect(DaddyLiveService.getPlaylistCatalogue()).toEqual([]);
  });

  it('serves the catalogue the last getCatalog produced, from memory', async () => {
    const catalog = await DaddyLiveService.getCatalog({ refresh: true });
    expect(catalog.channels.length).toBe(SOURCES.length * 4);
    expect(DaddyLiveService.getPlaylistCatalogue()).toBe(catalog.channels);
  });

  it('hands out a list a keyExtractor can use: one entry per id', () => {
    const channels = DaddyLiveService.getPlaylistCatalogue();
    const ids = new Set(channels.map((c) => c.id));
    expect(ids.size).toBe(channels.length);
    expect(ids.size).toBeGreaterThan(1);
  });

  it('is the same reference on every read, so list data does not churn per render', () => {
    expect(DaddyLiveService.getPlaylistCatalogue()).toBe(
      DaddyLiveService.getPlaylistCatalogue(),
    );
  });
});
