/**
 * Every measured decision the Live TV browse screen makes, kept out of the render
 * path and out of React Native so it can be unit-tested the way the rest of this
 * repo's decisions are. The screen reads these numbers and calls these functions;
 * it does not invent them.
 *
 * Nothing here imports the Live TV service. The channel shape is structural, so a
 * test can hand it a literal and the real `LiveChannel` still satisfies it.
 */
import { LIVE_TV } from '@/src/theme/tokens';

export type LiveTvMode = 'channels' | 'schedule';
export type LiveTvScope = 'all' | 'favorites' | 'recent';

/** The minimum a row needs to be drawn. `LiveChannel` carries all of it and more. */
export interface LiveChannelView {
  id: string;
  name: string;
  logoUrl?: string;
  nowPlaying?: string;
  nextUp?: string;
  categories: readonly string[];
}

export interface LiveScheduleEventView {
  id?: string;
  time: string;
  title: string;
  startsAt?: string;
  channels: readonly { id: string; name: string }[];
}

/**
 * One option list for each of the two segmented groups. Both groups are rendered by
 * the same component, which is the point: `Channels`/`Schedule` and
 * `All`/`Favorites`/`Recent` used to be two different-looking chip groups.
 */
export const MODE_OPTIONS: readonly { value: LiveTvMode; label: string }[] = [
  { value: 'channels', label: 'Channels' },
  { value: 'schedule', label: 'Schedule' },
];

export const SCOPE_OPTIONS: readonly { value: LiveTvScope; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'favorites', label: 'Favorites' },
  { value: 'recent', label: 'Recent' },
];

// ── Monogram ───────────────────────────────────────────────────────────────

/** A word is usable when it carries at least one letter or number. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

const splitWords = (name: string): string[] =>
  name
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => WORD_CHAR.test(word));

/** First code point of a word, counted in code points so an emoji name cannot split. */
const firstChar = (word: string): string => Array.from(word)[0] ?? '';

/**
 * Two letters from the first two words — `BBC News` → `BN`, `Channel 4` → `C4`,
 * because a digit is as much an initial as a letter. A single word gives its first
 * two characters; a name with nothing letter-like in it gives `?`, never a blank
 * tile. Deterministic and short, so the tile cannot reflow when the logo fails.
 *
 * Articles are deliberately kept: `The Movie Channel` is `TM`, which is what its own
 * logo says. Dropping them is a sorting rule, not a monogram rule.
 */
export const getChannelMonogram = (name: string): string => {
  const words = splitWords(name ?? '');
  if (!words.length) {
    const glyphs = Array.from((name ?? '').trim());
    return glyphs.length ? glyphs.slice(0, 1).join('').toUpperCase() : '?';
  }
  if (words.length === 1) {
    return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  }
  return (firstChar(words[0]) + firstChar(words[1])).toUpperCase();
};

/**
 * A 20dp tile cannot carry two legible letters, so the small tiles the schedule
 * uses take one. The threshold is a token, not a magic number in the component.
 */
export const getMonogramForTile = (name: string, tile: number): string => {
  const full = getChannelMonogram(name);
  if (tile >= LIVE_TV.monogramTwoLetterMin) return full;
  return Array.from(full).slice(0, 1).join('');
};

// ── Artwork ────────────────────────────────────────────────────────────────

/** A `tvg-logo` is free text from a playlist; an absurd value is not worth a request. */
export const LOGO_URL_MAX_LENGTH = 2048;

const HTTP_URL = /^https?:\/\/[^\s]+$/i;

/** The host part of an http(s) URL, or `null` when the value is not one. */
export const getLogoHost = (uri: string): string | null => {
  const withoutProtocol = uri.replace(/^https?:\/\//i, '');
  const host = withoutProtocol.split('/')[0];
  return host && host.includes('.') ? host : null;
};

/**
 * Only a plain absolute http(s) URL with a dotted host is worth asking the network
 * for. This refuses relative paths, `data:`/`file:` URIs, and values with embedded
 * whitespace — the shapes playlists actually carry — so a bad entry never reaches a
 * native image request and never shows a broken-image placeholder.
 */
export const normalizeLogoUri = (logoUrl?: string): string | null => {
  const raw = (logoUrl ?? '').trim();
  if (!raw || raw.length > LOGO_URL_MAX_LENGTH) return null;
  if (!HTTP_URL.test(raw)) return null;
  return getLogoHost(raw) ? raw : null;
};

export interface LogoHostBudget {
  shouldLoad: (uri: string) => boolean;
  reportFailure: (uri: string) => void;
  failuresFor: (host: string) => number;
  trackedHosts: () => number;
  reset: () => void;
}

/**
 * Third-party logo hosts fail for a whole playlist at once — a dead CDN is dead for
 * every channel on it. After `failureLimit` failures from one host, rows on that
 * host stop issuing requests and render the monogram instead: silent for the user,
 * cheap for the list, and bounded in memory by `maxHosts`.
 *
 * A factory rather than module state so the policy is testable in isolation; the
 * component holds one instance for the life of the process.
 */
export const createLogoHostBudget = (
  failureLimit: number = LIVE_TV.logoHostFailureLimit,
  maxHosts: number = LIVE_TV.logoHostBudget,
): LogoHostBudget => {
  const failures = new Map<string, number>();
  return {
    shouldLoad: (uri) => {
      const host = getLogoHost(uri);
      if (!host) return false;
      return (failures.get(host) ?? 0) < failureLimit;
    },
    reportFailure: (uri) => {
      const host = getLogoHost(uri);
      if (!host) return;
      const seen = failures.get(host);
      // The budget is full: keep answering for hosts already in it, learn nothing
      // new. Refusing to grow is the point — 12.5k channels must not build a map.
      if (seen === undefined && failures.size >= maxHosts) return;
      failures.set(host, (seen ?? 0) + 1);
    },
    failuresFor: (host) => failures.get(host) ?? 0,
    trackedHosts: () => failures.size,
    reset: () => failures.clear(),
  };
};

// ── Row content ────────────────────────────────────────────────────────────

export type RowSecondaryTone = 'now' | 'next' | 'meta';

export interface RowSecondary {
  /** The whole line, already composed, so the row renders one ellipsized Text. */
  line: string;
  /**
   * `now` gets the accent dot. Colour is carried by a shape rather than by a second
   * text class because a `StreamZText` variant already owns the label colour, and
   * two conflicting colour utilities on one node have no defined winner.
   */
  tone: RowSecondaryTone;
}

/**
 * Group names that say nothing about the channel. IPTV playlists ship these literally —
 * `undefined` is a real `group-title` value in the iptv-org feeds this app merges — and
 * showing a viewer a category called "Undefined" reads as a bug in the app rather than a
 * hole in the data.
 *
 * Deliberately narrow. `General` is left alone because it is arguable, and case is never
 * rewritten because `BBC`, `HBO` and `TN` would come out wrong.
 */
const UNCATEGORISED_TOKENS = new Set([
  'undefined',
  'unknown',
  'other',
  'others',
  'uncategorized',
  'uncategorised',
  'no category',
  'n/a',
  'na',
  'none',
  '-',
  '—',
]);

/**
 * A display label for a playlist group, or null when there is nothing to show.
 *
 * This is display-only on purpose: the filter still matches on the raw value, so two feeds
 * that disagree about `Undefined` versus `unknown` stay separate categories underneath while
 * the viewer sees one honest word for both.
 */
export const categoryLabel = (raw: string | null | undefined): string | null => {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  return UNCATEGORISED_TOKENS.has(text.toLowerCase()) ? 'Uncategorised' : text;
};

/**
 * What sits under the channel name. EPG first, then the channel's own first
 * category, so a row without listings still carries real information instead of
 * collapsing to one line and breaking the vertical rhythm. O(1) on every path.
 */
export const getRowSecondary = (channel: LiveChannelView): RowSecondary | null => {
  const now = channel.nowPlaying?.trim();
  if (now) return { line: `Now · ${now}`, tone: 'now' };
  const next = channel.nextUp?.trim();
  if (next) return { line: `Next · ${next}`, tone: 'next' };
  const category = categoryLabel(channel.categories[0]);
  if (category) return { line: category, tone: 'meta' };
  return null;
};

/** The favourite control's accessible name, so TalkBack does not read "button". */
export const favoriteControlLabel = (name: string, starred: boolean): string =>
  starred ? `Remove ${name} from favourites` : `Add ${name} to favourites`;

export const playControlLabel = (name: string): string => `Play ${name}`;

// ── Counts and copy ────────────────────────────────────────────────────────

/**
 * Grouped thousands without `Intl`, which Hermes does not guarantee. `12543` reads
 * as `12,543` here on every runtime, and the test pins it.
 */
export const formatCount = (value: number): string => {
  const safe = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  return safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** The identity line's real subtitle: what the catalogue actually returned. */
export const getCatalogueSummary = (channelCount: number, dayCount: number): string => {
  const channels = `${formatCount(channelCount)} channel${channelCount === 1 ? '' : 's'}`;
  if (dayCount <= 0) return channels;
  return `${channels} · ${formatCount(dayCount)}-day guide`;
};

/** The scope row's right-hand status: matches for what is on screen right now. */
export const getMatchSummary = (matchCount: number, hasQuery: boolean): string => {
  if (hasQuery) return `${formatCount(matchCount)} match${matchCount === 1 ? '' : 'es'}`;
  return `${formatCount(matchCount)} listed`;
};

/** A 70-char search string does not belong in an empty-state headline. */
export const clipQuery = (query: string, max = 24): string => {
  const trimmed = query.trim();
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max - 1);
  // End on a word boundary where one is available: the echoed query is a quotation
  // of what the person typed, and "the quick brown fox ju…" reads as a bug. A
  // boundary in the first half of the window is rejected, because dropping most of
  // the echo to keep one whole word shows less, and a single over-long word has no
  // boundary to find and is cut.
  const atSpace = head.lastIndexOf(' ');
  const body = atSpace >= Math.ceil(head.length / 2) ? head.slice(0, atSpace) : head;
  return `${body.trimEnd()}…`;
};

// ── Empty states ───────────────────────────────────────────────────────────

export type LiveTvEmptyAction = 'clearSearch' | 'clearCategory' | 'showAll' | null;

/** Which glyph the state block paints. The icon itself is chosen by the screen. */
export type LiveTvEmptyIcon =
  | 'favorites'
  | 'recent'
  | 'search'
  | 'category'
  | 'schedule'
  | 'catalogue';

export interface LiveTvEmptyState {
  title: string;
  message: string;
  action: LiveTvEmptyAction;
  icon: LiveTvEmptyIcon;
}

/** The action's label, so the copy is decided once and the screen only wires it up. */
export const EMPTY_ACTION_LABELS: Record<
  Exclude<LiveTvEmptyAction, null>,
  string
> = {
  clearSearch: 'Clear search',
  clearCategory: 'Show all categories',
  showAll: 'Show all channels',
};

export interface EmptyStateInput {
  mode: LiveTvMode;
  scope: LiveTvScope;
  query: string;
  category: string | null;
  /** Counts for the whole list, not the filtered one — they say *why* it is empty. */
  favoritesCount: number;
  recentsCount: number;
}

/**
 * One place decides what an empty list says, so no branch of the screen ends up
 * with a bare "No channels match." Text states the cause and the way out; the
 * action key (not a closure) keeps this pure and testable.
 */
export const resolveEmptyState = (input: EmptyStateInput): LiveTvEmptyState => {
  const query = clipQuery(input.query);
  const hasQuery = query.length > 0;
  const scopeName =
    input.scope === 'favorites'
      ? 'favourites'
      : input.scope === 'recent'
        ? 'recent channels'
        : null;

  if (input.mode === 'schedule') {
    if (hasQuery) {
      return {
        title: 'No listings match',
        message: `No listing in this guide matches “${query}”.`,
        action: 'clearSearch',
        icon: 'search',
      };
    }
    if (input.category) {
      return {
        title: `No listings in ${input.category}`,
        message: 'Try another category, or the whole guide.',
        action: 'clearCategory',
        icon: 'category',
      };
    }
    return {
      title: 'No guide for this day',
      message: 'The programme data for this day has not arrived. Pull to refresh.',
      action: null,
      icon: 'schedule',
    };
  }

  if (hasQuery) {
    return {
      title: 'No channels match',
      message: scopeName
        ? `Nothing in your ${scopeName} matches “${query}”.`
        : input.category
          ? `Nothing in ${input.category} matches “${query}”.`
          : `Nothing in the catalogue matches “${query}”.`,
      action: 'clearSearch',
      icon: 'search',
    };
  }

  if (input.scope === 'favorites' && input.favoritesCount === 0) {
    return {
      title: 'No favourites yet',
      message: 'Tap the star on any channel and it will stay here.',
      action: null,
      icon: 'favorites',
    };
  }

  if (input.scope === 'recent' && input.recentsCount === 0) {
    return {
      title: 'No recent channels',
      message: 'Play something once and it shows up here for a fast way back.',
      action: null,
      icon: 'recent',
    };
  }

  if (input.scope === 'favorites' || input.scope === 'recent') {
    return {
      title: scopeName ? `Nothing in your ${scopeName}` : 'Nothing here',
      message: input.category
        ? `None of the saved channels is in ${input.category}.`
        : 'The saved list is shorter than the filter you applied.',
      action: input.category ? 'clearCategory' : 'showAll',
      icon: input.scope === 'favorites' ? 'favorites' : 'recent',
    };
  }

  if (input.category) {
    return {
      title: `No channels in ${input.category}`,
      message: 'This category has no channels in the current catalogue.',
      action: 'clearCategory',
      icon: 'category',
    };
  }

  return {
    title: 'No channels',
    message: 'The catalogue came back with nothing in it. Pull to refresh.',
    action: null,
    icon: 'catalogue',
  };
};

// ── Schedule flattening ────────────────────────────────────────────────────

export type ScheduleRow =
  | { kind: 'header'; key: string; name: string; eventCount: number }
  | {
      kind: 'event';
      key: string;
      sectionName: string;
      timeLabel: string;
      event: LiveScheduleEventView;
    };

/**
 * The schedule used to render every event of a category inside one list item, so
 * one realised row could mount hundreds of children and the list could not tell how
 * tall it was. Flattening to header + event rows puts every row on the same
 * virtualised plane, which is also what makes it the sibling of channel mode.
 *
 * `formatTime` is injected: the real formatter lives with the service (and parses a
 * date), and the label belongs on the row model, not on a per-frame row render.
 */
export const flattenScheduleRows = <T extends LiveScheduleEventView>(
  sections: readonly { name: string; events: readonly T[] }[],
  formatTime: (event: T) => string,
): ScheduleRow[] => {
  const rows: ScheduleRow[] = [];
  for (const section of sections) {
    if (!section.events.length) continue;
    rows.push({
      kind: 'header',
      key: `section:${section.name}`,
      name: section.name,
      eventCount: section.events.length,
    });
    // A guide can legitimately carry the same title twice in one hour on the same
    // section — a simulcast, or a listing with no id at all. Identity plus start
    // time is the key, and only a literal repeat needs a suffix, so the list never
    // sees two of the same key.
    const repeats = new Map<string, number>();
    for (let index = 0; index < section.events.length; index += 1) {
      const event = section.events[index];
      const identity = event.id?.trim() || event.title.trim() || 'event';
      const base = `event:${section.name}:${identity}:${event.time}`;
      const seen = repeats.get(base) ?? 0;
      repeats.set(base, seen + 1);
      rows.push({
        kind: 'event',
        key: seen === 0 ? base : `${base}#${seen}`,
        sectionName: section.name,
        timeLabel: formatTime(event),
        event,
      });
    }
  }
  return rows;
};

/** Channels an event row paints before offering the rest. */
export const getEventChannelPreview = <T>(
  channels: readonly T[],
  expanded: boolean,
): readonly T[] => {
  if (expanded || channels.length <= LIVE_TV.eventChannelPreview) return channels;
  return channels.slice(0, LIVE_TV.eventChannelPreview);
};

export const hasHiddenEventChannels = (count: number): boolean =>
  count > LIVE_TV.eventChannelPreview;

// ── Chip rail ──────────────────────────────────────────────────────────────

/**
 * Chips ellipsize past this width instead of running under the screen edge. Half
 * the window, capped, so a tablet does not get a 200dp bubble and a narrow phone
 * does not get a chip wider than its own content area.
 */
export const getChipMaxWidth = (screenWidth: number): number =>
  Math.min(LIVE_TV.chipMaxWidth, Math.round(screenWidth * 0.6));

/** Rail height is fixed, so `Channels` → `Schedule` cannot move the list down. */
export const CHIP_RAIL_HEIGHT = LIVE_TV.chipRailHeight;
export const CHIP_HEIGHT = LIVE_TV.chipHeight;
export const CHIP_GAP = LIVE_TV.chipGap;
export const CHIP_HIT_SLOP = LIVE_TV.chipHitSlop;

/** The screen's five bands, and the rows inside the list, each on one step of the scale. */
export const BAND_GAP = LIVE_TV.bandGap;
export const ROW_GAP = LIVE_TV.rowGap;
