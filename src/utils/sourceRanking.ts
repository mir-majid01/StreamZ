/**
 * Deterministic ranking of the candidate playback sources a REST resolver lists
 * for one title.
 *
 * Why this exists: "first response wins" made the order of the provider's own
 * array decide what the user watched, which meant an undeclared-language host
 * that happened to be listed first beat a source that had told us it carries the
 * audio and subtitles the user is likely to want. A scorer replaces that with an
 * order that is reproducible from the data alone — same input, same output,
 * every time — and, just as important, keeps the *reasoning* attached to each
 * candidate so the developer surface can say why something was picked.
 *
 * What it is allowed to look at, and nothing else: the four REST extractors hand
 * back `id`, `extractor`, `uri`, `extractUrl`, `language` (only where a provider
 * claims one) and `subtitles` (only where a provider lists them at list time).
 * `kind` is deliberately not read for anything player-facing: it is the
 * `'hls' | 'file'` union the downloader and the party protocol consume, and two
 * of these providers fold DASH into `'hls'`. There is no measured success rate,
 * no verified codec probe and no resolved track list at this point, so no such
 * signal is invented here. A provider's `language` string is the provider's
 * claim, never a fact the app has checked, and the breakdown says so.
 */
import { liveSourceType } from '@/src/services/liveTv/sourceType';

/**
 * The audio languages the app prefers when the user has not said otherwise.
 * English and Hindi are the two the app's catalogue and provider claims actually
 * distinguish (Vidrock labels per-source language, Vidzee labels its five
 * regional servers); everything else is treated as "declared, but not preferred".
 */
export const DEFAULT_PREFERRED_AUDIO_LANGUAGES: readonly string[] = ['en', 'hi'];

/**
 * Extractors `StreamflixService.resolveSource` can turn into a URL, i.e. the ones
 * for which an empty `uri` means "one hop away" rather than "broken". The list is
 * duplicated knowledge from that function on purpose: the scorer must stay pure,
 * so it cannot call the resolver to find out. If `resolveSource` gains a case,
 * add it here.
 */
export const DEFAULT_EXTRACTABLE_EXTRACTORS: readonly string[] = ['videasy', 'vidzee'];

// ---------------------------------------------------------------------------
// Weights.
//
// They are integers so a sum is exactly reproducible. The spread of each signal
// is what makes the ordering contract hold:
//
//   readiness 200 | subtitles 120 | format 60 | prior 50  =>  430
//
// is the most a candidate can earn from everything *except* audio language while
// still being playable, and the least a preferred-language match can earn is
//   audio 300 + readiness 130 + subtitles 0 + format 20 + prior 10  =>  460.
//
// So among candidates the app can actually play, a declared preferred language
// can never be outvoted by an undeclared one — which is the requirement, stated
// as arithmetic rather than as a hope. (A candidate with no URL and no extraction
// path is the one thing allowed to score lower than its language would suggest,
// and ranking it last is correct: it cannot play.)
// ---------------------------------------------------------------------------

/** Media URL in hand: this candidate can be handed to the player immediately. */
const READINESS_URL_NOW = 200;
/**
 * No URL yet, but the app has an extraction path for it. Worth a lot, because
 * an empty `uri` is what Videasy and Vidzee list for *every* one of their servers
 * (6 + 13 for a movie, 5 + 13 for an episode) — reading that as "broken" would
 * throw away all of them and leave Vidrock as the only thing worth trying.
 */
const READINESS_EXTRACTABLE = 130;

/** First preferred language (default English). */
const AUDIO_PREFERRED_BASE = 400;
/** Per position further down the preferred list, so `en` beats `hi` by 50. */
const AUDIO_PREFERRED_STEP = 50;
/** Floor of a preferred match; see the 430-vs-460 arithmetic above. */
const AUDIO_PREFERRED_MIN = 300;
/** English is declared but not in the caller's preferred list. */
const AUDIO_ANY_ENGLISH = 250;
/** Hindi is declared but not in the caller's preferred list. */
const AUDIO_ANY_HINDI = 200;
/**
 * A language is declared and it is neither preferred nor English/Hindi (Tamil,
 * Bengali, …). Above "nothing is declared", because a claim the user can see and
 * reject is worth more than no information at all — but the gap is small, since
 * it is a *mismatch* with the stated preference.
 */
const AUDIO_DECLARED_OTHER = 100;
/**
 * Nothing declared. Zero, and the only tier that stays at zero: an undeclared
 * source is not assumed to be anything. `StreamflixService` deliberately leaves
 * Videasy's language unset because that endpoint does not say what audio a server
 * serves, so inventing "English" here would advertise a track we cannot observe.
 */
const AUDIO_UNDECLARED = 0;

/** Subtitles listed, at least one in a preferred language. */
const SUBS_PREFERRED = 120;
/** Subtitles listed, none in a preferred language. */
const SUBS_NON_PREFERRED = 60;
/** Subtitles listed, but no recognisable language on any of them. */
const SUBS_LANGUAGE_UNSTATED = 40;
/** No subtitle track listed at all. */
const SUBS_NONE = 0;

/** HLS playlist: read natively by ExoPlayer and by AVPlayer. */
const FORMAT_HLS = 60;
/** Progressive container (`.mp4`/`.mkv`/`.webm`/`.mov`/`.ts`): also played natively. */
const FORMAT_PROGRESSIVE = 55;
/**
 * DASH on Android: ExoPlayer has a DASH reader, but nothing in this app has ever
 * confirmed an `.mpd` end to end, so it is credited and not preferred.
 */
const FORMAT_DASH_ANDROID = 30;
/**
 * DASH on Apple platforms: AVPlayer has no DASH reader, and this app has no
 * second player behind it, so an `.mpd` here is a source we expect to fail.
 */
const FORMAT_DASH_APPLE = 0;
/**
 * Container not knowable yet (no URL until extraction). Non-zero and below the
 * proven shapes: the extractor's list-time `kind` is a guess its own comments
 * say not to trust, so the scorer must not pretend to know the container.
 */
const FORMAT_CONTAINER_UNKNOWN = 20;

/**
 * Structural priors, keyed by extractor. Seeded from one observable fact — which
 * of these list a usable URL and a subtitle track without a second request — and
 * from what the extraction hop costs. These are *not* measured success rates:
 * the app has never recorded a per-extractor outcome, so none is claimed here.
 */
const EXTRACTOR_PRIORS: Record<string, { points: number; reason: string }> = {
  vidrock: {
    points: 50,
    reason: 'every listed entry already carries a decrypted media URL and a language claim',
  },
  flixquest: {
    points: 45,
    reason: 'lists both the media URL and its subtitle tracks, so nothing has to be extracted',
  },
  videasy: {
    points: 24,
    reason: 'lists no URL and no subtitles; each candidate costs two extra requests before it can play',
  },
  vidzee: {
    points: 20,
    reason: 'lists no URL and no subtitles; extraction adds a key fetch plus a per-server decrypt',
  },
};
/** Anything we have never seen: no structural information, so no credit either way. */
const PRIOR_UNKNOWN = 10;

// ---------------------------------------------------------------------------
// Language normalisation
// ---------------------------------------------------------------------------

/**
 * Language names the four extractors can claim, plus the ones Wyzie-style
 * subtitle labels use, mapped to ISO 639-1. Deliberately a closed list: a string
 * that is not in here stays unknown instead of becoming a guess.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  english: 'en',
  hindi: 'hi',
  tamil: 'ta',
  telugu: 'te',
  bengali: 'bn',
  malayalam: 'ml',
  marathi: 'mr',
  gujarati: 'gu',
  kannada: 'kn',
  punjabi: 'pa',
  urdu: 'ur',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  japanese: 'ja',
  korean: 'ko',
  chinese: 'zh',
  arabic: 'ar',
  turkish: 'tr',
  russian: 'ru',
  indonesian: 'id',
  malay: 'ms',
  vietnamese: 'vi',
  thai: 'th',
  dutch: 'nl',
  polish: 'pl',
  swedish: 'sv',
  norwegian: 'no',
  danish: 'da',
  finnish: 'fi',
  greek: 'el',
  czech: 'cs',
  hungarian: 'hu',
  hebrew: 'he',
  romanian: 'ro',
  ukrainian: 'uk',
};

/** ISO 639-2/T (and the familiar 639-2/B) forms, for providers that send three letters. */
const LANGUAGE_ALIASES: Record<string, string> = {
  eng: 'en',
  hin: 'hi',
  tam: 'ta',
  tel: 'te',
  ben: 'bn',
  mal: 'ml',
  mar: 'mr',
  guj: 'gu',
  kan: 'kn',
  pan: 'pa',
  urd: 'ur',
  spa: 'es',
  fre: 'fr',
  fra: 'fr',
  ger: 'de',
  deu: 'de',
  ita: 'it',
  por: 'pt',
  jpn: 'ja',
  kor: 'ko',
  chi: 'zh',
  zho: 'zh',
  ara: 'ar',
  tur: 'tr',
  rus: 'ru',
  ind: 'id',
  vie: 'vi',
  tha: 'th',
  dut: 'nl',
  nld: 'nl',
  pol: 'pl',
  swe: 'sv',
  nor: 'no',
  dan: 'da',
  fin: 'fi',
  ell: 'el',
  gre: 'el',
  ces: 'cs',
  cze: 'cs',
  hun: 'hu',
  heb: 'he',
  ron: 'ro',
  ukr: 'uk',
};

/** Codes the two tables above can produce — what this app is willing to name. */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...Object.values(LANGUAGE_NAMES),
  ...Object.values(LANGUAGE_ALIASES),
]);

/** Longest-first, so "Malayalam" can never be claimed by the "Malay" entry. */
const LANGUAGE_NAME_ENTRIES: ReadonlyArray<[string, string]> = Object.entries(
  LANGUAGE_NAMES,
).sort((a, b) => b[0].length - a[0].length);

/** Display label for a normalised code; `undefined` for anything we do not know. */
export const languageLabelFor = (code?: string): string | undefined => {
  if (!code) return undefined;
  const entry = LANGUAGE_NAME_ENTRIES.find(([, c]) => c === code);
  return entry ? entry[0][0].toUpperCase() + entry[0].slice(1) : undefined;
};

/**
 * Best-effort ISO 639-1 from whatever a provider claims: a code (`en`, `en-IN`,
 * `eng`), a language name (`Hindi`), or a name inside a phrase
 * (`English (CC)`, `Hindi Dubbed`). Anything unrecognisable returns `undefined`,
 * which the scorer treats as "nothing is claimed" — never as English.
 */
export const normalizeLanguageTag = (raw?: string | null): string | undefined => {
  const text = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!text) return undefined;

  const first = text.match(/^[a-z]{2,3}(?=$|[-_\s(])/)?.[0];
  if (first) {
    if (LANGUAGE_ALIASES[first]) return LANGUAGE_ALIASES[first];
    if (/^[a-z]{2}$/.test(first) && KNOWN_CODES.has(first)) return first;
  }
  if (LANGUAGE_NAMES[text]) return LANGUAGE_NAMES[text];

  for (const [name, code] of LANGUAGE_NAME_ENTRIES) {
    if (text.includes(name)) return code;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface RankableSubtitle {
  readonly label: string;
  readonly file: string;
}

/**
 * Exactly the fields the scorer may read. `StreamflixSource` satisfies it, and
 * keeping this structural means the scorer never reaches for a field that only
 * exists after extraction.
 */
export interface RankableSource {
  readonly id: string;
  readonly kind: 'hls' | 'file';
  readonly uri: string;
  readonly extractor: string;
  readonly language?: string;
  readonly subtitles?: readonly RankableSubtitle[];
  readonly extractUrl?: string;
}

export interface ScoreSignal {
  readonly points: number;
  readonly reason: string;
}

export interface AudioSignal extends ScoreSignal {
  /** Normalised claim, or `undefined` when the provider claimed nothing. */
  readonly languageCode?: string;
  /** True only when a language string came back from the provider. */
  readonly declared: boolean;
  /**
   * What the developer surface may say out loud. For an undeclared source this
   * is a statement about the absence of a claim, never a language name.
   */
  readonly languageLabel: string;
}

export interface SubtitleSignal extends ScoreSignal {
  readonly count: number;
  readonly preferredLanguages: readonly string[];
}

export interface ReadinessSignal extends ScoreSignal {
  readonly state: 'url_now' | 'extractable' | 'unreachable';
}

export interface FormatSignal extends ScoreSignal {
  readonly container: 'hls' | 'progressive' | 'dash' | 'unknown';
}

export interface ScoreBreakdown {
  readonly total: number;
  readonly readiness: ReadinessSignal;
  readonly audio: AudioSignal;
  readonly subtitles: SubtitleSignal;
  readonly format: FormatSignal;
  readonly prior: ScoreSignal;
}

export interface RankedSource<T extends RankableSource> {
  readonly source: T;
  readonly score: ScoreBreakdown;
}

export interface RankingContext {
  /** Preferred audio languages, best first. Defaults to `['en', 'hi']`. */
  readonly preferredAudioLanguages?: readonly string[];
  /**
   * Preferred subtitle languages. Defaults to the audio preferences, because the
   * app has no separate playback-language setting and inventing one here would
   * rank on a preference nobody expressed.
   */
  readonly preferredSubtitleLanguages?: readonly string[];
  /** `Platform.OS`. Anything that is not an Apple platform gets the neutral reading. */
  readonly platform?: string;
  /** Extractors the app can run an extraction hop for. */
  readonly extractableExtractors?: readonly string[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const scoreReadiness = (source: RankableSource, extractable: readonly string[]): ReadinessSignal => {
  if (isHttpUrl(source.uri)) {
    return { points: READINESS_URL_NOW, state: 'url_now', reason: 'media URL already in hand' };
  }
  const needsExtraction = !source.uri.trim();
  const canExtract = extractable.includes(source.extractor);
  if (needsExtraction && canExtract && Boolean(source.extractUrl)) {
    return {
      points: READINESS_EXTRACTABLE,
      state: 'extractable',
      reason: 'one extraction hop away — no URL at list time, but this app can extract one',
    };
  }
  return {
    points: 0,
    state: 'unreachable',
    reason: 'no playback URL and no extraction path the app knows',
  };
};

const scoreAudio = (
  source: RankableSource,
  preferred: readonly string[],
): AudioSignal => {
  const code = normalizeLanguageTag(source.language);
  const claim = String(source.language ?? '')
    .trim()
    .slice(0, 40);

  if (!code) {
    return {
      points: AUDIO_UNDECLARED,
      declared: false,
      languageCode: undefined,
      languageLabel: 'language not stated',
      reason: source.language
        ? `provider said "${claim}", which this app cannot map to a language`
        : 'provider stated no audio language',
    };
  }

  const label = languageLabelFor(code) ?? code;
  const index = preferred.indexOf(code);
  if (index >= 0) {
    const points = Math.max(
      AUDIO_PREFERRED_MIN,
      AUDIO_PREFERRED_BASE - index * AUDIO_PREFERRED_STEP,
    );
    return {
      points,
      declared: true,
      languageCode: code,
      languageLabel: `claimed ${label}`,
      reason: `claimed ${label}: preferred #${index + 1}`,
    };
  }
  if (code === 'en') {
    return {
      points: AUDIO_ANY_ENGLISH,
      declared: true,
      languageCode: code,
      languageLabel: `claimed ${label}`,
      reason: 'claimed English, outside the preferred list',
    };
  }
  if (code === 'hi') {
    return {
      points: AUDIO_ANY_HINDI,
      declared: true,
      languageCode: code,
      languageLabel: `claimed ${label}`,
      reason: 'claimed Hindi, outside the preferred list',
    };
  }
  return {
    points: AUDIO_DECLARED_OTHER,
    declared: true,
    languageCode: code,
    languageLabel: `claimed ${label}`,
    reason: `claimed ${label}: not a preferred language`,
  };
};

const scoreSubtitles = (
  source: RankableSource,
  preferred: readonly string[],
): SubtitleSignal => {
  const tracks = source.subtitles ?? [];
  if (!tracks.length) {
    return {
      points: SUBS_NONE,
      count: 0,
      preferredLanguages: [],
      reason: 'no subtitle track listed',
    };
  }
  const codes = tracks
    .map((track) => normalizeLanguageTag(track.label))
    .filter((code): code is string => Boolean(code));
  const preferredHits = Array.from(new Set(codes.filter((code) => preferred.includes(code))));

  if (preferredHits.length) {
    return {
      points: SUBS_PREFERRED,
      count: tracks.length,
      preferredLanguages: preferredHits,
      reason: `${tracks.length} subtitle track(s), ${preferredHits
        .map((code) => languageLabelFor(code) ?? code)
        .join(', ')} among them`,
    };
  }
  if (codes.length) {
    return {
      points: SUBS_NON_PREFERRED,
      count: tracks.length,
      preferredLanguages: [],
      reason: `${tracks.length} subtitle track(s), none in a preferred language`,
    };
  }
  return {
    points: SUBS_LANGUAGE_UNSTATED,
    count: tracks.length,
    preferredLanguages: [],
    reason: `${tracks.length} subtitle track(s) listed without a language this app can read`,
  };
};

/**
 * Format compatibility, derived from the URL rather than from `kind`. `kind` is a
 * `'hls' | 'file'` union that `DownloadService` and the party protocol consume,
 * and both Vidrock and FlixQuest fold DASH into `'hls'` — which is exactly the
 * mis-typing that hands a `.mpd` to the HLS parser. The live path stopped doing
 * that by reading the URL shape (`src/services/liveTv/sourceType.ts`), so this
 * uses the same rule instead of a second, divergent one.
 */
const scoreFormat = (
  source: RankableSource,
  readiness: ReadinessSignal,
  applePlayer: boolean,
): FormatSignal => {
  if (readiness.state !== 'url_now') {
    return {
      points: FORMAT_CONTAINER_UNKNOWN,
      container: 'unknown',
      reason: 'container is only knowable after extraction; the list-time guess is not evidence',
    };
  }
  const hint = liveSourceType(source.uri);
  if (hint === 'mpd') {
    return applePlayer
      ? {
          points: FORMAT_DASH_APPLE,
          container: 'dash',
          reason: 'DASH manifest, and AVPlayer has no DASH reader behind this player',
        }
      : {
          points: FORMAT_DASH_ANDROID,
          container: 'dash',
          reason: 'DASH manifest: the platform player can read it, but this app has never proven one',
        };
  }
  if (hint === 'm3u8') {
    return {
      points: FORMAT_HLS,
      container: 'hls',
      reason: 'HLS playlist, which both players read natively',
    };
  }
  return {
    points: FORMAT_PROGRESSIVE,
    container: 'progressive',
    reason: 'progressive container, handed to the platform player directly',
  };
};

const scorePrior = (source: RankableSource): ScoreSignal => {
  const prior = EXTRACTOR_PRIORS[source.extractor];
  if (!prior) {
    return { points: PRIOR_UNKNOWN, reason: `unknown extractor "${source.extractor}" — no structural information` };
  }
  return { points: prior.points, reason: prior.reason };
};

/** Code-unit comparison: stable everywhere, unlike `localeCompare`. */
const compareStable = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};

/**
 * Score every candidate and return them best-first in a **new** array; the input
 * array and the candidate objects are never touched.
 *
 * Ordering contract (documented so it is testable, and so a future weight change
 * has to be a deliberate one):
 *  1. higher total score first;
 *  2. then extractor name, ascending in code-unit order;
 *  3. then source id, ascending in code-unit order.
 *
 * Rules 2 and 3 are the complete tie-break: two candidates with identical signals
 * are ordered the same way regardless of the order the host returned them in, and
 * there is no clock, random number, or network state anywhere in this function.
 */
export const rankSources = <T extends RankableSource>(
  candidates: readonly T[],
  context: RankingContext = {},
): RankedSource<T>[] => {
  const preferredAudio = context.preferredAudioLanguages ?? DEFAULT_PREFERRED_AUDIO_LANGUAGES;
  const preferredSubs = context.preferredSubtitleLanguages ?? preferredAudio;
  const extractable = context.extractableExtractors ?? DEFAULT_EXTRACTABLE_EXTRACTORS;
  const applePlayer = context.platform === 'ios' || context.platform === 'macos';

  return candidates
    .map((source) => {
      const readiness = scoreReadiness(source, extractable);
      const audio = scoreAudio(source, preferredAudio);
      const subtitles = scoreSubtitles(source, preferredSubs);
      const format = scoreFormat(source, readiness, applePlayer);
      const prior = scorePrior(source);
      const score: ScoreBreakdown = {
        total:
          readiness.points + audio.points + subtitles.points + format.points + prior.points,
        readiness,
        audio,
        subtitles,
        format,
        prior,
      };
      return { source, score };
    })
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        compareStable(a.source.extractor, b.source.extractor) ||
        compareStable(a.source.id, b.source.id),
    );
};

/** One-line, developer-surface-only summary of why a candidate scored what it did. */
export const formatScoreBreakdown = (score: ScoreBreakdown): string =>
  [
    `${score.total}`,
    `url:${score.readiness.state}`,
    `audio:${score.audio.languageLabel}`,
    `subs:${score.subtitles.count}`,
    `fmt:${score.format.container}`,
    `prior:+${score.prior.points}`,
  ].join(' · ');

/**
 * The player-facing `type` hint for an on-demand source, derived from the media
 * URL the same way the live path derives its hint. Keeping it here gives the
 * on-demand and live paths one rule instead of two that can drift: a `.mpd` that
 * an extractor filed under `kind: 'hls'` still reaches the player as `'mpd'`, and
 * a progressive file still gets no hint at all so the player infers it.
 *
 * This deliberately does not touch the `'hls' | 'file'` union that
 * `DownloadService` and `src/party/protocol.ts` consume.
 */
export type OnDemandSourceType = 'm3u8' | 'mpd' | undefined;

export const onDemandSourceType = (uri: string): OnDemandSourceType => liveSourceType(uri);
