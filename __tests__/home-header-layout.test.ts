/**
 * Owner item 7: the Home header "looks unfinished, especially the search icon
 * and the overall alignment of the StreamZ logo, version label and search
 * action".
 *
 * The causes were measurable, so they are asserted as data rather than eyeballed:
 *   - the wordmark was pinned inside a fixed 88×32 box while "StreamZ" at 19px
 *     with the brand's wide tracking is wider than 88px, so the logo was cut off;
 *   - the action was a bare 24px icon with 4px of padding — a 32dp target, under
 *     the 44dp floor, and it carried no surface, so it read as a loose glyph;
 *   - the three children sat on different lines because each was positioned by
 *     its own padding (`pt-3 pb-1`, a centred 32px box, an animated label pad).
 *
 * What still needs a build is stated in the report: optical alignment and
 * contrast against a specific hero poster cannot be proven from source.
 */
import { readFileSync } from 'fs';
import path from 'path';

import { HEADER, SPACE } from '@/src/theme/tokens';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

describe('header metrics', () => {
  it('meets the touch-target floor the brief sets', () => {
    expect(HEADER.actionTarget).toBeGreaterThanOrEqual(44);
    // The action has to fit the row it is centred in, with room either side.
    expect(HEADER.rowHeight).toBeGreaterThanOrEqual(HEADER.actionTarget);
  });

  it('takes its gap from the spacing scale instead of a magic number', () => {
    expect(HEADER.lockupGap).toBe(SPACE.md);
  });

  it('settles the logo rather than growing it', () =>
    expect(HEADER.logoScaleOverHero).toBeGreaterThan(HEADER.logoScaleSettled));
});

describe('AppHeader layout', () => {
  const header = read('src/components/AppHeader.tsx');

  it('no longer fixes the logo box, which is what clipped the wordmark', () => {
    expect(header).not.toMatch(/width:\s*88/);
    expect(header).not.toMatch(/height:\s*32/);
    expect(header).toContain('HEADER_LOGO_SIZE');
  });

  it('centres every child in one fixed-height row', () => {
    expect(header).toMatch(/height:\s*HEADER_ROW_HEIGHT/);
    expect(header).toContain('items-center justify-between');
    // The padding that used to position each child by hand is gone.
    expect(header).not.toMatch(/className="items-center space-between pt-3 pb-1"/);
    expect(header).not.toContain('VERSION_PADDING_LEFT_BASE');
  });

  it('anchors the scroll shrink to the row edge', () => {
    expect(header).toContain("transformOrigin: 'left center'");
    // The old shrink was paired with a `translateY` that moved the logo off the
    // line the rest of the row sat on.
    expect(header).not.toMatch(/translateY:\s*interpolate/);
  });

  it('keeps the safe-area inset internal and the backdrop animated', () => {
    expect(header).toContain('paddingTop: topInset');
    expect(header).toContain('progress?.value ?? 0');
    expect(header).toContain('border-b border-border bg-background');
  });

  it('keeps the version label, now beside the wordmark it describes', () => {
    expect(header).toContain('v{getAppVersion()}');
    expect(header).toContain('HEADER_LOCKUP_GAP');
  });

  it('sizes the action slot from the header, not the caller', () => {
    expect(header).toMatch(/minWidth:\s*HEADER_ACTION_SIZE/);
    expect(header).toMatch(/minHeight:\s*HEADER_ACTION_SIZE/);
  });
});

describe('Home search action', () => {
  const home = read('src/screens/HomeScreen.tsx');

  it('is a 44dp control with its own surface', () => {
    expect(home).toMatch(/width:\s*HEADER_ACTION_SIZE/);
    expect(home).toMatch(/height:\s*HEADER_ACTION_SIZE/);
    expect(home).toContain('rounded-full border border-border bg-card');
  });

  it('still navigates to Search, and takes the app-wide TV focus ring', () => {
    expect(home).toContain("navigation.navigate('Search')");
    expect(home).toContain('focusedClassName={TV_FOCUS_BORDER_CLASSNAME}');
  });

  it('still reads as a search action to a screen reader', () => {
    expect(home).toContain('accessibilityLabel="Search"');
  });

  it('the hero really does leave the header strip unbacked', () => {
    // Justification for giving the action its own surface instead of assuming a
    // scrim: the hero's gradient opens at `transparent` at its top edge, so the
    // poster is at full brightness behind the header while the screen is
    // unscrolled. If that ever changes, revisit the header treatment.
    const hero = read('src/components/HeroBanner.tsx');
    expect(hero).toContain("colors={['transparent',");
  });
});
