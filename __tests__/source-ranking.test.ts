/**
 * The rules that decide which candidate a title opens with. These are behaviour
 * contracts, not a restatement of the weights: every expectation here is something
 * the owner of the Play flow asked for and a future weight tweak could silently
 * break.
 */
import {
  DEFAULT_PREFERRED_AUDIO_LANGUAGES,
  normalizeLanguageTag,
  onDemandSourceType,
  rankSources,
  type RankableSource,
} from '@/src/utils/sourceRanking';

/**
 * Fixtures shaped like what the four REST extractors actually return at list
 * time, so nothing here is scored on a field a provider does not fill in:
 *  - vidrock: URI + a language claim, subtitles always empty;
 *  - videasy / vidzee: no URI and no language (Vidzee claims one for five
 *    regional servers only), subtitles unknown until extraction;
 *  - flixquest: URI + subtitles, no language.
 */
const make = (over: Partial<RankableSource> & Pick<RankableSource, 'id' | 'extractor'>): RankableSource => ({
  kind: 'hls',
  uri: '',
  subtitles: [],
  ...over,
});

const vidrock = (
  id: string,
  language: string | undefined,
  over: Partial<RankableSource> = {},
): RankableSource =>
  make({
    id,
    extractor: 'vidrock',
    language,
    uri: `https://vidrock.example/stream/${id}.m3u8`,
    ...over,
  });

const videasy = (id: string, over: Partial<RankableSource> = {}): RankableSource =>
  make({
    id,
    extractor: 'videasy',
    uri: '',
    extractUrl: `https://api.videasy.example/mb-flix/sources-with-title?tmdbId=1&title=${id}`,
    ...over,
  });

const vidzee = (id: string, language?: string): RankableSource =>
  make({
    id,
    extractor: 'vidzee',
    language,
    uri: '',
    extractUrl: `https://player.vidzee.example/api/server?id=1&sr=9#${id}`,
  });

const flixquest = (
  id: string,
  subtitles: { label: string; file: string }[] = [],
): RankableSource =>
  make({
    id,
    extractor: 'flixquest',
    uri: `https://fq.example/${id}.m3u8`,
    subtitles,
  });

const idsOf = (list: { source: RankableSource }[]): string[] =>
  list.map((entry) => entry.source.id);

describe('normalizeLanguageTag', () => {
  it('reads the claims these providers actually make', () => {
    expect(normalizeLanguageTag('English')).toBe('en');
    expect(normalizeLanguageTag('hindi')).toBe('hi');
    expect(normalizeLanguageTag('Malayalam')).toBe('ml');
    expect(normalizeLanguageTag('en-IN')).toBe('en');
    expect(normalizeLanguageTag('hin')).toBe('hi');
    expect(normalizeLanguageTag('English (CC)')).toBe('en');
  });

  it('refuses to invent a language out of anything it cannot map', () => {
    expect(normalizeLanguageTag(undefined)).toBeUndefined();
    expect(normalizeLanguageTag('')).toBeUndefined();
    expect(normalizeLanguageTag('   ')).toBeUndefined();
    expect(normalizeLanguageTag('Multi')).toBeUndefined();
    expect(normalizeLanguageTag('Unknown')).toBeUndefined();
    // A country flag is a region, not an audio track: `us` is not "English".
    expect(normalizeLanguageTag('us')).toBeUndefined();
    expect(normalizeLanguageTag('in')).toBeUndefined();
    expect(normalizeLanguageTag('gb')).toBeUndefined();
    // Longer names must not be claimed by a shorter one inside them.
    expect(normalizeLanguageTag('Malayalam')).not.toBe('ms');
  });
});

describe('rankSources', () => {
  const pool: RankableSource[] = [
    vidrock('vidrock-orion', 'English'),
    vidrock('vidrock-atlas', undefined),
    videasy('videasy-neon'),
    vidzee('vidzee-hindi', 'Hindi'),
    vidzee('vidzee-nflix', undefined),
    flixquest('fq-0-auto', [
      { label: 'English', file: 'https://fq.example/en.vtt' },
    ]),
  ];

  it('returns the same order for the same input, twice', () => {
    const first = idsOf(rankSources(pool));
    const second = idsOf(rankSources(pool));
    expect(first).toEqual(second);
  });

  it('returns the same order however the host ordered the input', () => {
    // Determinism has to mean "the provider's own order is not the decision",
    // so the reversed and rotated listings must rank identically.
    const forward = idsOf(rankSources(pool));
    const reversed = idsOf(rankSources([...pool].reverse()));
    const rotated = idsOf(rankSources([...pool.slice(2), ...pool.slice(0, 2)]));
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it('puts the declared preferred languages first, English before Hindi, and both ahead of anything undeclared', () => {
    const ranked = rankSources(pool);
    expect(DEFAULT_PREFERRED_AUDIO_LANGUAGES).toEqual(['en', 'hi']);
    expect(idsOf(ranked).slice(0, 2)).toEqual([
      'vidrock-orion',
      'vidzee-hindi',
    ]);
    const undeclared = ranked.filter((entry) => !entry.score.audio.declared);
    const declared = ranked.filter((entry) => entry.score.audio.declared);
    const worstMatch = Math.min(...declared.map((e) => e.score.audio.points));
    const bestUndeclared = Math.max(...undeclared.map((e) => e.score.audio.points));
    expect(worstMatch).toBeGreaterThan(0);
    expect(bestUndeclared).toBe(0);
  });

  it('ranks a listing that can offer English *and* Hindi above one that offers only English', () => {
    const both = idsOf(rankSources(pool));
    const englishOnly = idsOf(
      rankSources(pool.filter((s) => s.id !== 'vidzee-hindi')),
    );
    // Both preferred languages surface ahead of anything that claims nothing.
    expect(both.slice(0, 2)).toEqual(['vidrock-orion', 'vidzee-hindi']);
    // Without a Hindi source to promote, second place falls to the source with
    // English subtitles — still not to a language the user did not ask for.
    expect(englishOnly.slice(0, 2)).toEqual(['vidrock-orion', 'fq-0-auto']);
  });

  it('outranks an otherwise identical source for having subtitles in a preferred language', () => {
    const withPreferredSubs = flixquest('fq-with-subs', [
      { label: 'English', file: 'https://fq.example/en.vtt' },
    ]);
    const withOtherSubs = flixquest('fq-other-subs', [
      { label: 'Spanish', file: 'https://fq.example/es.vtt' },
    ]);
    const withUnstatedSubs = flixquest('fq-unstated-subs', [
      { label: 'Unknown', file: 'https://fq.example/x.vtt' },
    ]);
    const withoutSubs = flixquest('fq-no-subs');

    const ranked = idsOf(
      rankSources([
        withoutSubs,
        withUnstatedSubs,
        withOtherSubs,
        withPreferredSubs,
      ]),
    );
    expect(ranked).toEqual([
      'fq-with-subs',
      'fq-other-subs',
      'fq-unstated-subs',
      'fq-no-subs',
    ]);
    expect(
      rankSources([withPreferredSubs])[0].score.subtitles.preferredLanguages,
    ).toEqual(['en']);
  });

  it('never ranks an undeclared language above a declared preferred one, and never calls it a language', () => {
    // The strongest possible all-else-equal case for the undeclared source: it
    // already has a URL, it has English subtitles, it is a native-reading HLS
    // playlist, and it carries the best provider prior. The declared source has
    // the weakest of those: it still needs an extraction hop and lists nothing.
    const rich = vidrock('vidrock-rich', undefined, {
      subtitles: [{ label: 'English', file: 'https://v.example/en.vtt' }],
    });
    const declaredHindi = vidzee('vidzee-hindi', 'Hindi');

    const ranked = rankSources([rich, declaredHindi]);
    expect(idsOf(ranked)).toEqual(['vidzee-hindi', 'vidrock-rich']);

    const undeclared = ranked.find((e) => e.source.id === 'vidrock-rich')!;
    expect(undeclared.score.audio.points).toBe(0);
    expect(undeclared.score.audio.declared).toBe(false);
    expect(undeclared.score.audio.languageCode).toBeUndefined();
    expect(undeclared.score.audio.languageLabel).toBe('language not stated');
    expect(undeclared.score.audio.languageLabel.toLowerCase()).not.toContain('english');
  });

  it('breaks a total tie on extractor, then on id, in code-unit order', () => {
    // Built to tie exactly: 200 readiness + 0 audio + 0 subtitles, then vidrock's
    // 55 (progressive) + 50 (prior) against flixquest's 60 (HLS) + 45 (prior).
    const vidrockMp4 = make({
      id: 'vidrock-z',
      extractor: 'vidrock',
      uri: 'https://x.example/z.mp4',
    });
    const flixquestHls = make({
      id: 'fq-a',
      extractor: 'flixquest',
      uri: 'https://x.example/a.m3u8',
    });
    const acrossExtractors = rankSources([vidrockMp4, flixquestHls]);
    expect(acrossExtractors[0].score.total).toBe(acrossExtractors[1].score.total);
    expect(idsOf(acrossExtractors)).toEqual(['fq-a', 'vidrock-z']);

    // Same extractor, same everything: id decides, and it decides the same way
    // whichever order the host returned them in.
    const sameExtractor = [
      make({ id: 'vidrock-z', extractor: 'vidrock', uri: 'https://x.example/z.m3u8' }),
      make({ id: 'vidrock-a', extractor: 'vidrock', uri: 'https://x.example/z.m3u8' }),
    ];
    expect(idsOf(rankSources(sameExtractor))).toEqual(['vidrock-a', 'vidrock-z']);
    expect(idsOf(rankSources([...sameExtractor].reverse()))).toEqual(
      idsOf(rankSources(sameExtractor)),
    );
  });

  it('does not mutate the caller’s array or its candidate objects', () => {
    const snapshot = pool.map((s) => ({ ...s }));
    const ranked = rankSources(pool);

    expect(ranked).not.toBe(pool);
    expect(pool).toEqual(snapshot);
    expect(pool.map((s) => s.id)).toEqual(snapshot.map((s) => s.id));
    // The wrappers are new objects; the sources inside them are the caller's own.
    expect(ranked[0].source).toBe(pool.find((s) => s.id === ranked[0].source.id));
    ranked.pop();
    expect(pool.map((s) => s.id)).toEqual(snapshot.map((s) => s.id));
  });

  it('keeps a source with an empty uri, because that is one hop away rather than broken', () => {
    const listed = [vidrock('vidrock-a', 'English'), videasy('videasy-neon'), vidzee('vidzee-nflix')];
    const ranked = rankSources(listed);

    expect(ranked).toHaveLength(3);
    expect(idsOf(ranked)).toContain('videasy-neon');

    const extracted = ranked.find((e) => e.source.id === 'videasy-neon')!;
    expect(extracted.score.readiness.state).toBe('extractable');
    expect(extracted.score.readiness.points).toBeGreaterThan(0);
    // Its container is only knowable after extraction, and the scorer says so
    // instead of trusting the extractor's list-time `kind` guess.
    expect(extracted.score.format.container).toBe('unknown');
  });

  it('keeps, but ranks last, a candidate with no URL and no extraction path', () => {
    const dead = make({ id: 'dead', extractor: 'vidrock', uri: '' });
    const ranked = rankSources([dead, vidrock('live', 'English')]);
    expect(ranked).toHaveLength(2);
    expect(idsOf(ranked)).toEqual(['live', 'dead']);
    expect(ranked[1].score.readiness.state).toBe('unreachable');
  });

  it('takes the player’s platform into account for format, so DASH is not preferred on iOS', () => {
    const dash = make({
      id: 'fq-dash',
      extractor: 'flixquest',
      uri: 'https://fq.example/manifest.mpd',
      // Filed as 'hls' by FlixQuest's `kindOf`, which is the mis-typing this
      // ranking must not repeat.
      kind: 'hls',
    });
    const hls = flixquest('fq-hls');

    expect(rankSources([dash, hls], { platform: 'android' })[0].source.id).toBe(
      'fq-hls',
    );
    const ios = rankSources([dash, hls], { platform: 'ios' });
    expect(ios[0].source.id).toBe('fq-hls');
    expect(
      ios.find((e) => e.source.id === 'fq-dash')!.score.format.reason,
    ).toMatch(/AVPlayer/);
  });

  it('honours a caller-supplied preference list instead of assuming English', () => {
    const tamil = vidrock('vidrock-tamil', 'Tamil');
    const english = vidrock('vidrock-english', 'English');
    expect(idsOf(rankSources([tamil, english]))).toEqual([
      'vidrock-english',
      'vidrock-tamil',
    ]);
    expect(
      idsOf(rankSources([tamil, english], { preferredAudioLanguages: ['ta', 'en'] })),
    ).toEqual(['vidrock-tamil', 'vidrock-english']);
  });
});

describe('onDemandSourceType', () => {
  it('derives DASH from the URL even when the extractor filed it as hls', () => {
    // `FlixQuestService.kindOf` answers 'hls' for `isDASH`, and
    // `PlayerScreen` used to turn any 'hls' into `type: 'm3u8'`, so a `.mpd`
    // went to the HLS parser and failed as a malformed playlist.
    expect(onDemandSourceType('https://fq.example/a/manifest.mpd')).toBe('mpd');
    expect(onDemandSourceType('https://fq.example/a/manifest.mpd?token=abc')).toBe(
      'mpd',
    );
    expect(onDemandSourceType('https://fq.example/a/MANIFEST.MPD')).toBe('mpd');
    expect(onDemandSourceType('https://fq.example/a/manifest.mpd')).not.toBe(
      'm3u8',
    );
  });

  it('names an HLS playlist, and says nothing about a progressive file', () => {
    expect(onDemandSourceType('https://v.example/a/master.m3u8')).toBe('m3u8');
    expect(onDemandSourceType('https://v.example/a/master.m3u8#t=10')).toBe('m3u8');
    expect(onDemandSourceType('https://v.example/a/movie.mp4?start=0')).toBeUndefined();
    expect(onDemandSourceType('https://v.example/a/clip.mkv')).toBeUndefined();
  });

  it('reads the path, not the host or the query', () => {
    expect(
      onDemandSourceType('https://mpd.example.mpd:443/edge/index.m3u8'),
    ).toBe('m3u8');
    expect(onDemandSourceType('https://h.example/render?path=/a/b.mp4')).toBe(
      'm3u8',
    );
  });

  // Deliberately no fourth case with its own extension table: this hint is the
  // live path's rule (`src/services/liveTv/sourceType.ts`) reached through one
  // seam, and a second copy of the expectations here is how the two drift.
});
