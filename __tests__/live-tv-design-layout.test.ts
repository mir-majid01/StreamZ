/**
 * Owner item P1: the Live TV browse screen was "overly minimal and had weak visual
 * hierarchy", and the brief asked for a premium dark screen that keeps 12.5k rows
 * virtualised and keeps its controls on the app's 44dp floor.
 *
 * Everything asserted here is a decision that can be measured, so it lives in
 * `src/components/liveTv/liveTvLayout.ts` and is tested as data — the same shape
 * `home-header-layout.test.ts` uses. Optical judgement (does the star *look* centred,
 * is the accent restrained enough) is not testable from source and is reported as
 * needing a build.
 */
import {
  HEADER,
  LIVE_TV,
  SPACE,
} from '@/src/theme/tokens';

import {
  MODE_OPTIONS,
  SCOPE_OPTIONS,
  CHIP_RAIL_HEIGHT,
  clipQuery,
  createLogoHostBudget,
  EMPTY_ACTION_LABELS,
  favoriteControlLabel,
  flattenScheduleRows,
  formatCount,
  getCatalogueSummary,
  getChannelMonogram,
  getChipMaxWidth,
  getEventChannelPreview,
  getMatchSummary,
  getMonogramForTile,
  getRowSecondary,
  hasHiddenEventChannels,
  normalizeLogoUri,
  resolveEmptyState,
  type LiveChannelView,
} from '@/src/components/liveTv/liveTvLayout';

const channel = (over: Partial<LiveChannelView> = {}): LiveChannelView => ({
  id: 'iptv:iptv-org:bbc-one',
  name: 'BBC News',
  categories: ['News'],
  ...over,
});

describe('touch targets and the token block they come from', () => {
  it('keeps every pressable on the floor the brief sets', () => {
    // A segment is the track minus its own inset; a chip paints smaller than it
    // presses and says so with hitSlop. Both must still clear 44.
    expect(LIVE_TV.trackHeight - LIVE_TV.trackInset * 2).toBeGreaterThanOrEqual(44);
    expect(LIVE_TV.chipHeight + LIVE_TV.chipHitSlop * 2).toBeGreaterThanOrEqual(44);
    expect(LIVE_TV.rowActionTarget).toBeGreaterThanOrEqual(44);
    expect(LIVE_TV.searchFieldHeight).toBeGreaterThanOrEqual(44);
  });

  it('takes the row control from the header measure rather than a second opinion', () => {
    expect(LIVE_TV.rowActionTarget).toBe(HEADER.actionTarget);
  });

  it('builds its rhythm off the spacing scale, not off magic numbers', () => {
    expect(LIVE_TV.chipGap).toBe(SPACE.sm);
    expect(LIVE_TV.rowGap).toBe(SPACE.sm);
    expect(LIVE_TV.bandGap).toBe(SPACE.md);
    // Bands breathe more than rows: the controls are separate decisions, the rows are
    // one list.
    expect(LIVE_TV.bandGap).toBeGreaterThan(LIVE_TV.rowGap);
    expect(CHIP_RAIL_HEIGHT).toBeGreaterThanOrEqual(LIVE_TV.chipHeight);
  });

  it('gives the artwork tile and the row a deliberate relationship', () => {
    expect(LIVE_TV.logoTile).toBe(44);
    expect(LIVE_TV.rowMinHeight).toBeGreaterThan(LIVE_TV.logoTile + 16);
    // The inset has to leave something of the tile visible around a wide logo.
    expect(LIVE_TV.logoInset).toBeGreaterThan(0);
    expect(LIVE_TV.logoInset * 2).toBeLessThan(LIVE_TV.logoTile);
  });

  it('windows the list at the numbers the player drawer already ships with', () => {
    expect(LIVE_TV.listInitial).toBe(10);
    expect(LIVE_TV.listWindowSize).toBeGreaterThanOrEqual(7);
    expect(LIVE_TV.listBatch).toBeLessThanOrEqual(LIVE_TV.listInitial);
  });

  it('reserves the schedule time column for a real time label', () => {
    // "10:30 PM" is the widest thing `formatEventTime` can produce at the secondary
    // size; a narrower rule wraps it and the column stops ruling anything.
    expect(LIVE_TV.scheduleTimeWidth).toBeGreaterThanOrEqual(60);
    expect('10:30 PM'.length).toBeLessThanOrEqual(8);
  });
});

describe('getChannelMonogram', () => {
  it('takes one initial from each of the first two words', () => {
    expect(getChannelMonogram('BBC News')).toBe('BN');
    expect(getChannelMonogram('Sky Sports Main Event')).toBe('SS');
  });

  it('treats a number as an initial, because broadcast names are built that way', () => {
    expect(getChannelMonogram('Channel 4')).toBe('C4');
    expect(getChannelMonogram('RTM 1')).toBe('R1');
  });

  it('falls back to the first two letters when there is only one word', () => {
    expect(getChannelMonogram('France')).toBe('FR');
    expect(getChannelMonogram('mavshare')).toBe('MA');
  });

  it('keeps a leading article, which is what the station’s own logo spells', () => {
    expect(getChannelMonogram('The Movie Channel')).toBe('TM');
    expect(getChannelMonogram('La Une')).toBe('LU');
    // ...and a name that is only one word still gets two letters.
    expect(getChannelMonogram('The')).toBe('TH');
  });

  it('collapses whitespace and punctuation padding', () => {
    expect(getChannelMonogram('  BBC   News  ')).toBe('BN');
    expect(getChannelMonogram('|—| Al Jazeera')).toBe('AJ');
  });

  it('survives a 72-character name without growing past two characters', () => {
    const long = `${'International '.repeat(6)}News`.slice(0, 72);
    expect(long.length).toBe(72);
    expect(Array.from(getChannelMonogram(long))).toHaveLength(2);
  });

  it('never returns an empty string, which would leave a blank tile', () => {
    expect(getChannelMonogram('')).toBe('?');
    expect(getChannelMonogram('   ')).toBe('?');
    expect(getChannelMonogram('···')).toBe('·');
  });

  it('keeps non-Latin names legible instead of dropping them', () => {
    expect(getChannelMonogram('中国中央电视台')).toBe('中国');
    expect(getChannelMonogram('العربية'))
      .toBe(Array.from('العربية').slice(0, 2).join('').toUpperCase());
  });

  it('gives small tiles one letter, and only above the token threshold two', () => {
    expect(getMonogramForTile('BBC News', LIVE_TV.logoTile)).toBe('BN');
    expect(getMonogramForTile('BBC News', 24)).toBe('B');
    expect(getMonogramForTile('BBC News', LIVE_TV.monogramTwoLetterMin)).toBe('BN');
  });
});

describe('logo URLs and the host budget', () => {
  it('accepts a plain absolute image URL', () => {
    expect(
      normalizeLogoUri('https://i.mjh.nz/PlutoTV/us.bbc-world-news.png'),
    ).toBe('https://i.mjh.nz/PlutoTV/us.bbc-world-news.png');
    expect(normalizeLogoUri('http://logos.example.com/channels/bbc.png')).toBe(
      'http://logos.example.com/channels/bbc.png',
    );
  });

  it('refuses the shapes a playlist actually carries by mistake', () => {
    expect(normalizeLogoUri(undefined)).toBeNull();
    expect(normalizeLogoUri('')).toBeNull();
    expect(normalizeLogoUri('   ')).toBeNull();
    // relative, non-http, hostless, whitespace inside, and absurdly long
    expect(normalizeLogoUri('/images/logo.png')).toBeNull();
    expect(normalizeLogoUri('data:image/png;base64,AAAA')).toBeNull();
    expect(normalizeLogoUri('file:///sdcard/logo.png')).toBeNull();
    expect(normalizeLogoUri('ftp://cdn.example/logo.png')).toBeNull();
    expect(normalizeLogoUri('https://localhost/logo.png')).toBeNull();
    expect(normalizeLogoUri('https://cdn.example/a b.png')).toBeNull();
    expect(normalizeLogoUri(`https://cdn.example/${'x'.repeat(3000)}.png`)).toBeNull();
  });

  it('stops asking a host after the token limit, silently', () => {
    const budget = createLogoHostBudget(3, 12);
    const url = 'https://dead.example/logo.png';
    expect(budget.shouldLoad(url)).toBe(true);
    budget.reportFailure(url);
    budget.reportFailure(url);
    expect(budget.shouldLoad(url)).toBe(true);
    budget.reportFailure(url);
    expect(budget.shouldLoad(url)).toBe(false);
    expect(budget.failuresFor('dead.example')).toBe(3);
    // Another host on the same screen is unrelated and keeps asking.
    expect(budget.shouldLoad('https://other.example/logo.png')).toBe(true);
  });

  it('bounds the number of hosts it remembers, so 12.5k rows cannot grow a map', () => {
    const budget = createLogoHostBudget(1, 2);
    budget.reportFailure('https://a.example/x.png');
    budget.reportFailure('https://b.example/x.png');
    budget.reportFailure('https://c.example/x.png');
    expect(budget.trackedHosts()).toBe(2);
    expect(budget.shouldLoad('https://a.example/x.png')).toBe(false);
    // A new host past the budget is not learned; it keeps its artwork rather than
    // the list paying for an unbounded set.
    expect(budget.shouldLoad('https://c.example/x.png')).toBe(true);
  });

  it('does not count a URL it cannot attribute to a host', () => {
    const budget = createLogoHostBudget(1, 2);
    budget.reportFailure('not-a-url');
    expect(budget.trackedHosts()).toBe(0);
    expect(budget.shouldLoad('not-a-url')).toBe(false);
  });

  it('can be cleared, which is what the tests and a manual refresh both want', () => {
    const budget = createLogoHostBudget(1, 2);
    budget.reportFailure('https://a.example/x.png');
    expect(budget.shouldLoad('https://a.example/x.png')).toBe(false);
    budget.reset();
    expect(budget.trackedHosts()).toBe(0);
    expect(budget.shouldLoad('https://a.example/x.png')).toBe(true);
  });
});

describe('row content derivation', () => {
  it('prefers what is on now, then what is next, then the channel’s own category', () => {
    expect(getRowSecondary(channel({ nowPlaying: 'News at Ten', nextUp: 'Later' }))).toEqual({
      line: 'Now · News at Ten',
      tone: 'now',
    });
    expect(getRowSecondary(channel({ nextUp: 'Later' }))).toEqual({
      line: 'Next · Later',
      tone: 'next',
    });
    expect(getRowSecondary(channel())).toEqual({ line: 'News', tone: 'meta' });
    expect(getRowSecondary(channel({ categories: [] }))).toBeNull();
  });

  it('ignores blank EPG strings rather than painting an empty "Now · "', () => {
    expect(getRowSecondary(channel({ nowPlaying: '   ' }))).toEqual({
      line: 'News',
      tone: 'meta',
    });
  });

  it('gives the favourite control a sentence, not a glyph name', () => {
    expect(favoriteControlLabel('BBC News', false)).toBe('Add BBC News to favourites');
    expect(favoriteControlLabel('BBC News', true)).toBe('Remove BBC News from favourites');
  });
});

describe('counts and summary lines', () => {
  it('groups thousands without depending on Intl', () => {
    expect(formatCount(12543)).toBe('12,543');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(-5)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
  });

  it('only claims the guide length it was given', () => {
    expect(getCatalogueSummary(12543, 3)).toBe('12,543 channels · 3-day guide');
    expect(getCatalogueSummary(1, 0)).toBe('1 channel');
    expect(getCatalogueSummary(12543, 1)).toBe('12,543 channels · 1-day guide');
  });

  it('says matches while searching and listed otherwise', () => {
    expect(getMatchSummary(1, true)).toBe('1 match');
    expect(getMatchSummary(2, true)).toBe('2 matches');
    expect(getMatchSummary(12543, false)).toBe('12,543 listed');
  });

  it('clips a long query out of headline copy without adding length', () => {
    expect(clipQuery('  bbc news ')).toBe('bbc news');
    const long = clipQuery('a'.repeat(60), 24);
    expect(long.length).toBe(24);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('empty states are written, not improvised', () => {
  const base = {
    mode: 'channels' as const,
    scope: 'all' as const,
    query: '',
    category: null,
    favoritesCount: 0,
    recentsCount: 0,
  };

  it('tells a user with no favourites how to get one', () => {
    expect(resolveEmptyState({ ...base, scope: 'favorites' })).toMatchObject({
      title: 'No favourites yet',
      icon: 'favorites',
      action: null,
    });
  });

  it('tells a user with no history what will appear here', () => {
    expect(resolveEmptyState({ ...base, scope: 'recent' })).toMatchObject({
      title: 'No recent channels',
      icon: 'recent',
      action: null,
    });
  });

  it('distinguishes an empty saved list from a filter that excluded everything', () => {
    expect(
      resolveEmptyState({ ...base, scope: 'favorites', favoritesCount: 12, category: 'News' }),
    ).toMatchObject({ action: 'clearCategory', icon: 'favorites' });
    expect(
      resolveEmptyState({ ...base, scope: 'recent', recentsCount: 4 }),
    ).toMatchObject({ action: 'showAll' });
  });

  it('offers to clear a search that found nothing, and quotes what was searched', () => {
    const state = resolveEmptyState({ ...base, query: 'bbs' });
    expect(state.action).toBe('clearSearch');
    expect(state.icon).toBe('search');
    expect(state.message).toContain('“bbs”');
  });

  it('names the category it could not fill', () => {
    expect(resolveEmptyState({ ...base, category: 'Kids' })).toMatchObject({
      title: 'No channels in Kids',
      action: 'clearCategory',
    });
  });

  it('speaks about listings, not channels, in schedule mode', () => {
    expect(resolveEmptyState({ ...base, mode: 'schedule' })).toMatchObject({
      icon: 'schedule',
      title: 'No guide for this day',
    });
    expect(resolveEmptyState({ ...base, mode: 'schedule', query: 'rugby' })).toMatchObject({
      title: 'No listings match',
      action: 'clearSearch',
    });
  });

  it('never offers an action it has no label for', () => {
    const states = [
      resolveEmptyState(base),
      resolveEmptyState({ ...base, scope: 'favorites', favoritesCount: 3 }),
      resolveEmptyState({ ...base, query: 'x' }),
      resolveEmptyState({ ...base, category: 'News' }),
      resolveEmptyState({ ...base, mode: 'schedule', category: 'News' }),
    ];
    for (const state of states) {
      if (state.action) expect(EMPTY_ACTION_LABELS[state.action]).toBeTruthy();
    }
  });
});

describe('the schedule is flattened before it reaches the list', () => {
  const events = (count: number, section: string) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${section}-${i}`,
      time: `${18 + i}:00`,
      title: `${section} event ${i}`,
      channels: [{ id: `iptv:iptv-org:c${i}`, name: `Channel ${i}` }],
    }));

  const formatTime = (event: { time: string }) => `${event.time}!`;

  it('puts a header in front of each run of listings', () => {
    const rows = flattenScheduleRows(
      [
        { name: 'Sports', events: events(2, 'Sports') },
        { name: 'News', events: events(1, 'News') },
      ],
      formatTime,
    );
    expect(rows.map((row) => row.kind)).toEqual([
      'header',
      'event',
      'event',
      'header',
      'event',
    ]);
    expect(rows[0]).toEqual({ kind: 'header', key: 'section:Sports', name: 'Sports', eventCount: 2 });
  });

  it('formats each time once, on the row, not in the row renderer', () => {
    const rows = flattenScheduleRows([{ name: 'Sports', events: events(1, 'Sports') }], formatTime);
    expect(rows[1]).toMatchObject({ timeLabel: '18:00!' });
  });

  it('gives every row a unique, stable key', () => {
    const sections = [
      { name: 'Sports', events: events(30, 'Sports') },
      { name: 'News', events: events(30, 'News') },
    ];
    const first = flattenScheduleRows(sections, formatTime).map((row) => row.key);
    const second = flattenScheduleRows(sections, formatTime).map((row) => row.key);
    expect(new Set(first).size).toBe(first.length);
    expect(first).toEqual(second);
    expect(first.length).toBe(62);
  });

  it('keys an event with no id off its title and time, and still keeps repeats unique', () => {
    const rows = flattenScheduleRows(
      [
        {
          name: 'Films',
          events: [
            { time: '21:00', title: 'A Film', channels: [] },
            { time: '21:00', title: 'A Film', channels: [] },
            { time: '21:00', title: 'A Film', channels: [] },
          ],
        },
      ],
      formatTime,
    );
    const keys = rows.filter((row) => row.kind === 'event').map((row) => row.key);
    expect(keys).toEqual([
      'event:Films:A Film:21:00',
      'event:Films:A Film:21:00#1',
      'event:Films:A Film:21:00#2',
    ]);
    // A duplicated key is a list that stops rendering rows, so this is the invariant.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries no row at all for an empty section', () => {
    expect(flattenScheduleRows([{ name: 'Empty', events: [] }], formatTime)).toEqual([]);
  });

  it('previews a bounded run of channels and offers the rest', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `C${i}` }));
    expect(getEventChannelPreview(many, false)).toHaveLength(LIVE_TV.eventChannelPreview);
    expect(getEventChannelPreview(many, true)).toHaveLength(9);
    // The array is handed through untouched when there is nothing to hide, so a
    // normal single-channel listing allocates nothing per render.
    const one = [{ id: 'c', name: 'C' }];
    expect(getEventChannelPreview(one, false)).toBe(one);
    expect(hasHiddenEventChannels(many.length)).toBe(true);
    expect(hasHiddenEventChannels(LIVE_TV.eventChannelPreview)).toBe(false);
  });
});

describe('chip overflow', () => {
  it('never lets a chip reach the width of the rail it scrolls in', () => {
    expect(getChipMaxWidth(360)).toBe(200);
    expect(getChipMaxWidth(320)).toBe(192);
    expect(getChipMaxWidth(200)).toBe(120);
    expect(getChipMaxWidth(360)).toBeLessThan(360);
    expect(getChipMaxWidth(1000)).toBeLessThanOrEqual(LIVE_TV.chipMaxWidth);
  });
});

describe('the two nav groups really are one family', () => {
  it('both are the same option shape, so one component renders both', () => {
    const shape = (option: { value: string; label: string }) =>
      Object.keys(option).sort().join(',');
    for (const option of [...MODE_OPTIONS, ...SCOPE_OPTIONS]) {
      expect(shape(option)).toBe(shape({ value: 'x', label: 'y' }));
    }
  });

  it('they cover exactly the states the screen holds', () => {
    expect(MODE_OPTIONS.map((o) => o.value)).toEqual(['channels', 'schedule']);
    expect(SCOPE_OPTIONS.map((o) => o.value)).toEqual(['all', 'favorites', 'recent']);
    // Longest label decides the track width, and nothing here can wrap a segment.
    for (const option of [...MODE_OPTIONS, ...SCOPE_OPTIONS]) {
      expect(option.label.length).toBeLessThanOrEqual(9);
    }
  });
});
