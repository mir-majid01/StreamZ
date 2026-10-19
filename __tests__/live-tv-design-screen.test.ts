/**
 * Owner item P1, the screen-level half: this repo's Jest cannot import anything
 * under `src/screens/` (module evaluation trips inside `react-native-css`), so the
 * wiring is asserted by reading the source, exactly like `search-field-focus.test.ts`
 * and `home-header-layout.test.ts` do. The measurable decisions behind these strings
 * live in `live-tv-design-layout.test.ts`.
 *
 * What this cannot prove — and the report says so — is how any of it looks. Every
 * optical judgement here still needs a build.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const screen = read('src/screens/LiveTvScreen.tsx');
const row = read('src/components/liveTv/LiveChannelRow.tsx');
const logo = read('src/components/liveTv/ChannelLogo.tsx');
const segmented = read('src/components/liveTv/LiveTvSegmented.tsx');
const rail = read('src/components/liveTv/LiveChipRail.tsx');
const scheduleRow = read('src/components/liveTv/LiveScheduleRow.tsx');
const chrome = read('src/components/liveTv/LiveTvChrome.tsx');
const states = read('src/components/liveTv/LiveTvStates.tsx');
const pressable = read('src/components/liveTv/LiveTvPressable.tsx');
const searchScreen = read('src/screens/SearchScreen.tsx');
const homeScreen = read('src/screens/HomeScreen.tsx');

describe('one control family, not two chip groups', () => {
  it('renders both nav groups through the same segmented component', () => {
    expect((screen.match(/<LiveTvSegmented/g) ?? []).length).toBe(2);
    expect(screen).toContain('options={MODE_OPTIONS}');
    expect(screen).toContain('options={SCOPE_OPTIONS}');
  });

  it('has deleted the screen-local chip that made the old two-looking groups', () => {
    expect(screen).not.toMatch(/const Chip = /);
    expect(screen).not.toMatch(/<Chip\b/);
  });

  it('routes every horizontal chip group through one rail', () => {
    // categories + EPG days
    expect((screen.match(/<LiveChipRail/g) ?? []).length).toBe(2);
    // ...and no ad-hoc ScrollView row of chips is left behind.
    expect(screen).not.toContain('<ScrollView');
  });

  it('keeps the mode track and the scope track geometrically identical', () => {
    expect(segmented).toContain('height: LIVE_TV.trackHeight');
    expect(segmented).toContain('padding: LIVE_TV.trackInset');
    expect(segmented).toContain(
      'minHeight: LIVE_TV.trackHeight - LIVE_TV.trackInset * 2',
    );
    // One label variant for both states, so selecting a segment cannot resize it.
    expect(segmented).toContain('variant="cardTitle"');
    expect((segmented.match(/variant="cardTitle"/g) ?? []).length).toBe(1);
  });

  it('makes the selected option legible to a screen reader, in both families', () => {
    expect(pressable).toContain('accessibilityState={{ selected, disabled }}');
    expect(pressable).toContain('accessibilityRole={role}');
    expect(segmented).toContain('selected={selected}');
    expect(rail).toContain('selected={selected}');
  });
});

/**
 * Measured on the Infinix (1224px wide, density 3) from the installed 0.1.2 build,
 * through the accessibility tree rather than by eye: the `All` segment was 57px wide
 * holding a 57px label, so its 16dp side padding had not arrived; the category chip
 * was 23dp tall against `chipHeight: 36`; the channel row 47dp against
 * `rowMinHeight: 72`; the star control 17dp against its 44dp target. Every one of
 * those numbers is an inline `style` on a `LiveTvPressable`, and every one was
 * dropped — because that prop was a function, and react-native-css merges a
 * `className` with the inline style by placing both in one array, which React
 * Native’s style flattener then discards.
 */
describe('the pressable keeps its geometry by never using a style callback', () => {
  it('passes a plain style array, not a callback', () => {
    expect(pressable).not.toMatch(/style=\{(\(|[A-Za-z_$][\w$]*\s*=>)/);
    expect(pressable).toMatch(/style=\{\[[^\]]*\]\}/s);
  });

  it('still paints the pressed fill, now through the state it tracks', () => {
    expect(pressable).toContain('onPressIn=');
    expect(pressable).toContain('onPressOut=');
    expect(pressable).toContain('pressed && !disabled ? pressedStyle : undefined');
  });
});

describe('the header band and the search interaction', () => {
  it('gives the screen an identity line with the catalogue’s own numbers', () => {
    expect(screen).toContain('<LiveTvIdentityBar');
    expect(screen).toContain('getCatalogueSummary(channels.length, days.length)');
    expect(chrome).toContain('variant="screenTitle"');
    expect(chrome).toContain('minHeight: HEADER.rowHeight');
    expect(chrome).toContain('width: HEADER.actionTarget');
  });

  it('reuses the app’s own search field shape, not a new one', () => {
    const houseField = 'h-12 rounded-full bg-card';
    expect(searchScreen).toContain(houseField);
    expect(screen).toContain(houseField);
    expect(screen).toContain('<InputIcon as={SearchIcon}');
  });

  it('adds the two things that make it a control rather than a slot', () => {
    expect(screen).toContain('onChangeText={setQuery}');
    expect(screen).toContain('returnKeyType="search"');
    // Enter closes the keyboard without throwing the filter away.
    expect(screen).toContain('onSubmitEditing={releaseField}');
    // and the field can be emptied without backspacing it out.
    expect(screen).toContain('accessibilityLabel="Clear the search"');
    expect(screen).toContain('onPress={clearQuery}');
  });

  it('keeps the focus release wiring the IME regression depends on', () => {
    expect(screen).toContain('releaseFieldFocusRef');
    expect(screen).toContain('useFocusEffect');
    const at = screen.indexOf('<InputField');
    expect(at).toBeGreaterThan(-1);
    expect(screen.slice(at, at + 420)).toContain('ref={fieldRef');
    const playChannel = screen.slice(
      screen.indexOf('const playChannel = useCallback'),
      screen.indexOf('const openChannel = useCallback'),
    );
    expect(playChannel).toContain('releaseField()');
    expect(playChannel.indexOf('releaseField()')).toBeLessThan(
      playChannel.indexOf('await DaddyLiveService.getStream'),
    );
  });

  it('does not fabricate anything in the header', () => {
    // No invented "LIVE" badge, no invented bitrate, no invented quality label.
    expect(screen).not.toMatch(/\bLIVE\b/);
    expect(screen).not.toMatch(/kbps|Mbps|\bquality\b/i);
    expect(row).not.toMatch(/\bLIVE\b/);
  });
});

describe('channel rows', () => {
  it('shows real artwork and a derived fallback, never an invented one', () => {
    expect(row).toContain('<ChannelLogo');
    expect(logo).toContain('logoUrl');
    expect(logo).toContain('getMonogramForTile');
    // Nothing here reaches for a bundled placeholder asset or a generated image.
    expect(logo).not.toMatch(/require\(|ImageGen|placeholder\.(png|jpg|svg)/i);
  });

  it('lets a logo host die quietly and cheaply', () => {
    expect(logo).toContain('normalizeLogoUri');
    expect(logo).toContain('logoBudget.reportFailure');
    expect(logo).toContain('setFailedUri');
    expect(logo).toContain('createLogoHostBudget');
    // A failing image must not raise a console line per row.
    expect(logo).not.toMatch(/console\.(log|warn|error)/);
  });

  it('is memoised and takes primitives, so scrolling re-renders nothing', () => {
    expect(row).toContain('export const LiveChannelRow = memo(');
    expect(row).toContain('starred: boolean');
    expect(row).toContain('resolving: boolean');
    // The handlers arrive from the screen, where they are useCallback-stable.
    expect(row).toContain('onToggleFavorite(channel.id)');
  });

  it('deliberately does not allocate or read clocks per row', () => {
    expect(row).not.toMatch(/new Date\(|\.filter\(|\.sort\(/);
    expect(row).not.toMatch(/\.map\(/);
    expect(scheduleRow).not.toMatch(/new Date\(/);
  });

  it('sizes the favourite control off the 44dp floor and centres it on the row', () => {
    expect(row).toContain('width: LIVE_TV.rowActionTarget');
    expect(row).toContain('height: LIVE_TV.rowActionTarget');
    expect(row).toContain('items-center rounded-xl');
    expect(row).toContain('minHeight: LIVE_TV.rowMinHeight');
    expect(row).toContain('accessibilityLabel={favoriteControlLabel(');
    expect(row).toContain('accessibilityLabel={playControlLabel(');
  });

  it('ellipsizes a long name on one line and keeps the text block flexible', () => {
    expect(row).toContain('numberOfLines={1}');
    expect(row).toContain('ml-3 flex-1 justify-center');
    expect(row).toContain('maxFontSizeMultiplier={LIVE_TV.rowMaxFontScale}');
  });

  it('says something true on the second line, and holds the rhythm when it cannot', () => {
    expect(row).toContain('getRowSecondary(channel)');
    // The dot is always painted so now/next/category lines share one left edge.
    expect(row).toContain("'bg-transparent'");
  });
});

describe('the catalogue stays virtualised', () => {
  it('keeps both lists as FlatLists with an id-keyed, stable key', () => {
    expect((screen.match(/<FlatList/g) ?? []).length).toBe(2);
    expect(screen).toContain('data={orderedChannels}');
    expect(screen).toContain('data={scheduleRows}');
    expect(screen).toContain('keyExtractor={(item) => item.id}');
    expect(screen).toContain('keyExtractor={(row) => row.key}');
  });

  it('windows both lists with the same numbers, from the token block', () => {
    expect((screen.match(/\{\.\.\.LIST_WINDOW\}/g) ?? []).length).toBe(2);
    expect(screen).toContain('initialNumToRender: LIVE_TV.listInitial');
    expect(screen).toContain('maxToRenderPerBatch: LIVE_TV.listBatch');
    expect(screen).toContain('windowSize: LIVE_TV.listWindowSize');
    expect(screen).toContain('removeClippedSubviews');
  });

  it('never puts the catalogue in a scroll view or maps over it in the render path', () => {
    expect(screen).not.toMatch(/orderedChannels\.map\(/);
    expect(screen).not.toMatch(/\{channels\.map\(/);
    expect(screen).not.toMatch(/categoryItems\}\.map/);
    // The schedule no longer renders a category's whole event list inside one row.
    expect(screen).not.toMatch(/section\.events\.map\(/);
    expect(screen).toContain('flattenScheduleRows(scheduleSections, formatEventTime)');
  });

  it('keeps the id-keyed catalogue index the schedule depends on', () => {
    expect(screen).toContain('buildChannelIndex(channels)');
    expect(screen).toContain('resolveScheduleChannel(channelIndex, reference)');
    expect(scheduleRow).toContain('resolveChannel(reference)');
  });

  it('lets a tap land through the keyboard', () => {
    expect((screen.match(/keyboardShouldPersistTaps="handled"/g) ?? []).length).toBe(2);
  });
});

describe('schedule mode is the sibling, not a different app', () => {
  it('shares the row surface, radius and padding with a channel row', () => {
    expect(scheduleRow).toContain('rounded-xl border border-border bg-card');
    expect(row).toContain('rounded-xl border border-border bg-card');
    expect(scheduleRow).toContain('borderRadius: RADIUS.md');
    expect(scheduleRow).toContain('paddingLeft: SPACE.md');
  });

  it('rules the time in its own fixed column', () => {
    expect(scheduleRow).toContain('width: LIVE_TV.scheduleTimeWidth');
  });

  it('reuses the same logo language and the same 44dp sub-row target', () => {
    expect(scheduleRow).toContain('<ChannelLogo');
    expect(scheduleRow).toContain('tile={24}');
    expect(scheduleRow).toContain('minHeight: LIVE_TV.rowActionTarget');
  });

  it('bounds the channels an event paints before offering more', () => {
    expect(scheduleRow).toContain('getEventChannelPreview(channels, expanded)');
    expect(scheduleRow).toContain('hasHiddenEventChannels(channels.length)');
    expect(scheduleRow).toContain('useState(false)');
  });

  it('counts listings rather than inventing a popularity signal', () => {
    expect(scheduleRow).toContain('{formatCount(eventCount)}');
  });
});

describe('states are designed', () => {
  it('gives the empty list a title, a reason, and a way out', () => {
    expect(screen).toContain('<LiveTvStateBlock');
    expect(screen).toContain('EMPTY_ACTION_LABELS[emptyState.action]');
    expect(screen).toContain('resolveEmptyState({');
    expect(states).toContain('rounded-2xl border border-border bg-card');
    // Icon tile + title + message, like the shared state view, but sized by padding
    // so it survives inside a ListEmptyComponent.
    expect(states).not.toMatch(/className="flex-1/);
    expect(screen).toContain('ListEmptyComponent={emptyList}');
  });

  it('replaces the spinner-over-nothing with the screen’s own chrome', () => {
    expect(screen).toContain('<LiveTvSkeleton horizontalPadding={padding} />');
    expect(chrome).toContain('StreamZSkeleton');
    expect(chrome).toContain('minHeight: LIVE_TV.rowMinHeight');
    // The unrecoverable case still uses the shared error state rather than a new one.
    expect(screen).toContain('<StreamZErrorState');
  });

  it('turns the old bare error text into a notice with a retry', () => {
    expect(screen).toContain('<LiveTvNotice icon={CloudOff} message={error} onRetry={refresh} />');
    expect(states).toContain('text-primary');
    expect(states).toContain('minHeight: 44');
  });
});

describe('restraint', () => {
  it('uses no gradient, no animation, and no decorative blob on this screen', () => {
    for (const source of [screen, row, logo, segmented, rail, scheduleRow, states]) {
      expect(source).not.toMatch(/LinearGradient|StreamZGradient|useSharedValue|withTiming|withSpring/);
    }
    // The one motion left is the list's own refresh indicator and the skeleton breath.
    expect(screen).toContain('<RefreshControl');
  });

  it('paints the accent only where it means something', () => {
    const accentUses = [
      segmented, // selected segment
      rail, // selected chip
      row, // the now dot and the saved star
      chrome, // the identity mark and the busy spinner
    ].reduce((sum, source) => sum + (source.match(/bg-primary|text-primary/g) ?? []).length, 0);
    expect(accentUses).toBeLessThanOrEqual(10);
  });

  it('keeps the house surfaces and hairlines rather than inventing colours', () => {
    const house = /bg-background|bg-card|border border-border|text-muted-foreground|text-foreground/;
    for (const source of [screen, row, segmented, rail, scheduleRow, states, chrome]) {
      expect(source).toMatch(house);
    }
    // No raw hex in the components: colours are classes or tokens.
    for (const source of [row, logo, segmented, rail, scheduleRow, states]) {
      expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });

  it('matches Home’s use of the header action slot for its trailing control', () => {
    expect(homeScreen).toContain('rounded-full border border-border bg-card');
    expect(chrome).toContain('rounded-full border border-border bg-card');
  });
});
