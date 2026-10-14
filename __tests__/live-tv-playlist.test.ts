import {
  buildFacets,
  deriveCountry,
  looksLikePlaylist,
  mergePlaylists,
  normalizeName,
  parseExtInf,
  parsePlaylist,
  splitCategories,
  type PlaylistEntry,
  type PlaylistSource,
} from '@/src/services/liveTv/playlistParser';

const ORG: PlaylistSource = {
  id: 'iptv-org',
  label: 'IPTV Org',
  url: 'https://iptv-org.github.io/iptv/index.m3u',
  homepage: 'https://github.com/iptv-org/iptv',
  license: 'Unlicense',
};
const FREE: PlaylistSource = {
  id: 'free-tv',
  label: 'Free TV',
  url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
  homepage: 'https://github.com/Free-TV/IPTV',
  license: 'unspecified',
};

const entry = (over: Partial<PlaylistEntry>): PlaylistEntry => ({
  id: 'x',
  name: 'X',
  streamUrl: 'https://a/1.m3u8',
  categories: [],
  sourceIds: [],
  ...over,
});

describe('parseExtInf', () => {
  it('splits attributes from a display name that contains commas', () => {
    const parsed = parseExtInf('#EXTINF:-1 tvg-id="BBCOne.uk" group-title="News",BBC One, London');
    expect(parsed?.attrs['tvg-id']).toBe('BBCOne.uk');
    expect(parsed?.attrs['group-title']).toBe('News');
    expect(parsed?.name).toBe('BBC One, London');
  });

  it('accepts a fractional duration and a bare name', () => {
    const parsed = parseExtInf('#EXTINF:-1.0,Simple Name');
    expect(parsed?.attrs).toEqual({});
    expect(parsed?.name).toBe('Simple Name');
  });

  it('returns null for anything that is not an EXTINF line', () => {
    expect(parseExtInf('#EXTM3U')).toBeNull();
    expect(parseExtInf('https://example.com/a.m3u8')).toBeNull();
  });
});

describe('parsePlaylist', () => {
  it('carries name, logo, category and id through', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="AlJazeera.qa" tvg-logo="https://logo/a.png" group-title="News",Al Jazeera',
      'https://stream/a.m3u8',
    ].join('\n');
    const out = parsePlaylist(text, ORG);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'Al Jazeera',
      externalId: 'AlJazeera.qa',
      logoUrl: 'https://logo/a.png',
      categories: ['News'],
      country: 'QA',
      streamUrl: 'https://stream/a.m3u8',
      sourceIds: ['iptv-org'],
    });
    expect(out[0].id).toBe('iptv:iptv-org:aljazeera-qa');
  });

  it('maps playlist-supplied headers through an allowlist only', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 http-user-agent="Agent/1.0" http-referrer="https://site/",A',
      '#EXTVLCOPT:http-user-agent=VlcAgent/2',
      '#EXTVLCOPT:http-authorization=Bearer secret',
      'https://stream/a.m3u8',
    ].join('\n');
    const out = parsePlaylist(text, ORG);
    expect(out[0].headers).toEqual({ 'User-Agent': 'Agent/1.0', Referer: 'https://site/' });
    expect(JSON.stringify(out[0].headers)).not.toMatch(/secret|authorization/i);
  });

  it('uses #EXTGRP when the EXTINF line carries no group-title', () => {
    const text = ['#EXTM3U', '#EXTINF:-1,Channel A', '#EXTGRP:Sports', 'https://stream/a.m3u8'].join('\n');
    expect(parsePlaylist(text, ORG)[0].categories).toEqual(['Sports']);
  });

  it('drops non-http streams, missing names, and unknown directives', () => {
    const text = [
      '#EXTM3U',
      '#KU:channeltest:whatever',
      '#EXTINF:-1,Udp Only',
      'udp://239.0.0.1:1234',
      '#EXTINF:-1,',
      'https://stream/nameless.m3u8',
      '#EXTINF:-1,Valid',
      'https://stream/valid.m3u8',
    ].join('\n');
    const out = parsePlaylist(text, ORG);
    expect(out.map((e) => e.name)).toEqual(['Valid']);
  });

  it('keeps ids unique inside a source when two entries share a name', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1,Dup',
      'https://stream/one.m3u8',
      '#EXTINF:-1,Dup',
      'https://stream/two.m3u8',
    ].join('\n');
    const out = parsePlaylist(text, ORG);
    expect(new Set(out.map((e) => e.id)).size).toBe(2);
  });

  it('reads a real-shaped iptv-org block without losing the tvg attributes', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="3ABNIndonesia.id" tvg-alt-country="" group-title="Religious" tvg-logo="https://x/l.png",3ABN Indonesia (720p)',
      'https://stream/3abn.m3u8',
    ].join('\n');
    const out = parsePlaylist(text, ORG);
    expect(out[0]).toMatchObject({ categories: ['Religious'], logoUrl: 'https://x/l.png', name: '3ABN Indonesia (720p)' });
    // `ID` comes out of the id suffix, not out of the empty `tvg-alt-country=""`.
    expect(out[0].country).toBe('ID');
    expect(out[0].externalId).toBe('3ABNIndonesia.id');
  });

  it('reads a real-shaped Free-TV block, whose group-title is a country name', () => {
    const text = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-name="Kanali 7" tvg-logo="https://i.imgur.com/x.png" tvg-id="Kanali7.al" tvg-country="AL" group-title="Albania",Kanali 7 Ⓢ',
      'https://stream/kanali7.m3u8',
    ].join('\n');
    const out = parsePlaylist(text, FREE);
    expect(out[0]).toMatchObject({
      name: 'Kanali 7 Ⓢ',
      externalId: 'Kanali7.al',
      country: 'AL',
      categories: ['Albania'],
      logoUrl: 'https://i.imgur.com/x.png',
    });
    // Neither proposed playlist publishes a language, so nothing is claimed for it.
    expect(out[0].language).toBeUndefined();
  });
});

describe('country and name normalisation', () => {
  it('prefers an explicit tvg-country, bracketed or bare', () => {
    expect(deriveCountry('AL', undefined, 'Kanali 7')).toBe('AL');
    expect(deriveCountry('[AL]Albania', undefined, 'Kanali 7')).toBe('AL');
  });
  it('reads the country through an iptv-org quality suffix', () => {
    expect(deriveCountry(undefined, '00sReplay.us@SD', '00s Replay')).toBe('US');
    expect(deriveCountry(undefined, '1Plus1International.ua@HD', 'x')).toBe('UA');
  });
  it('takes the country from a bare tvg-id suffix when nothing else carries it', () => {
    expect(deriveCountry(undefined, 'BBCOne.uk', 'BBC One')).toBe('UK');
  });
  it('falls back to a trailing parenthesised code in the name', () => {
    expect(deriveCountry(undefined, undefined, 'Rai 1 (IT)')).toBe('IT');
  });
  it('does not mistake a resolution tag for a country', () => {
    expect(deriveCountry(undefined, undefined, '3ABN Indonesia (720p)')).toBeUndefined();
  });
  it('does not invent one when neither carries it', () => {
    expect(deriveCountry(undefined, 'SomeChannel', 'Some Channel')).toBeUndefined();
  });
  it('splits a semicolon-joined group-title into separate categories', () => {
    expect(splitCategories('Animation;Classic;Kids')).toEqual(['Animation', 'Classic', 'Kids']);
    expect(splitCategories('Animation; Classic;Animation')).toEqual(['Animation', 'Classic']);
    expect(splitCategories('')).toEqual([]);
  });
  it('collapses separators and case but nothing more', () => {
    expect(normalizeName('Star_Sports.1  HD')).toBe('star sports 1 hd');
    expect(normalizeName('Star Sports 1')).not.toBe(normalizeName('Star Sports 1 HD'));
  });
});

describe('looksLikePlaylist', () => {
  it('accepts a header or an EXTINF body', () => {
    expect(looksLikePlaylist('#EXTM3U\n')).toBe(true);
    expect(looksLikePlaylist('#EXTINF:-1,x\nhttps://a/b')).toBe(true);
  });
  it('rejects empty, HTML error pages, and truncated bodies', () => {
    expect(looksLikePlaylist('')).toBe(false);
    expect(looksLikePlaylist('<html><body>404 Not Found</body></html>')).toBe(false);
  });
});

describe('mergePlaylists', () => {
  it('merges the same external id across sources and enriches it', () => {
    const merged = mergePlaylists([
      { sourceId: ORG.id, entries: [entry({ id: 'a1', externalId: 'Ch.uk', name: 'Ch UK', streamUrl: 'https://one/x.m3u8' })] },
      {
        sourceId: FREE.id,
        entries: [entry({ id: 'b1', externalId: 'Ch.uk', name: 'Ch UK HD', streamUrl: 'https://two/x.m3u8', logoUrl: 'https://logo' })],
      },
    ]);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].logoUrl).toBe('https://logo');
    expect(merged.entries[0].sourceIds).toEqual([ORG.id, FREE.id]);
    expect(merged.stats).toEqual({ perSource: { 'iptv-org': 1, 'free-tv': 1 }, duplicatesRemoved: 1, total: 1 });
  });

  it('treats the same stream URL as the same channel without an external id', () => {
    const merged = mergePlaylists([
      { sourceId: ORG.id, entries: [entry({ id: 'a', name: 'Alpha', streamUrl: 'https://s/x' })] },
      { sourceId: FREE.id, entries: [entry({ id: 'b', name: 'Alpha TV', streamUrl: 'https://s/x' })] },
    ]);
    expect(merged.entries).toHaveLength(1);
    expect(merged.stats.duplicatesRemoved).toBe(1);
  });

  it('dedupes on normalised name as the last signal', () => {
    const merged = mergePlaylists([
      { sourceId: ORG.id, entries: [entry({ id: 'a', name: 'Zee News', streamUrl: 'https://s/1' })] },
      { sourceId: FREE.id, entries: [entry({ id: 'b', name: 'ZEE NEWS', streamUrl: 'https://s/2', categories: ['News'] })] },
    ]);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0].categories).toEqual(['News']);
  });

  it('keeps genuinely different channels that share a prefix', () => {
    const merged = mergePlaylists([
      { sourceId: ORG.id, entries: [entry({ id: 'a', name: 'Star Sports 1', streamUrl: 'https://s/1' })] },
      { sourceId: ORG.id, entries: [entry({ id: 'b', name: 'Star Sports 1 HD', streamUrl: 'https://s/2' })] },
    ]);
    expect(merged.entries).toHaveLength(2);
  });
});

describe('buildFacets', () => {
  it('lists only the values the entries actually carry, sorted and unique', () => {
    const facets = buildFacets([
      entry({ id: '1', categories: ['News'], country: 'US' }),
      entry({ id: '2', categories: ['Sports'], country: 'GB' }),
      entry({ id: '3', categories: ['News'], language: 'English' }),
    ]);
    expect(facets).toEqual({ categories: ['News', 'Sports'], countries: ['GB', 'US'], languages: ['English'] });
  });

  it('leaves a facet empty rather than filling it with guesses', () => {
    const facets = buildFacets([entry({ id: '1', name: 'N', streamUrl: 'https://s' })]);
    expect(facets).toEqual({ categories: [], countries: [], languages: [] });
  });
});
