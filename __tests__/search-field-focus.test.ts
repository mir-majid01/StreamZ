/**
 * Owner item 4: "the Android keyboard sometimes appears unexpectedly when
 * opening a movie."
 *
 * The cause is focus the app never gives back: the search field is the only text
 * input on the Home → Search → Detail → Player path, and on Android the keyboard
 * tracks the view that holds focus, which react-native-screens deliberately
 * preserves while a screen is transitioned away from. So the field has to be
 * released when Search is left — see `src/utils/fieldFocus.ts` for the native
 * code that makes this the app's job.
 *
 * These tests pin the helper's behaviour and the wiring, and — just as
 * importantly — pin that the fix did *not* come from disabling the keyboard
 * app-wide, which would have broken normal search.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

import {
  releaseFieldFocus,
  releaseFieldFocusRef,
  type FieldHandle,
} from '@/src/utils/fieldFocus';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const field = (focused: boolean): FieldHandle & { blur: jest.Mock; isFocused: jest.Mock } => ({
  blur: jest.fn(),
  isFocused: jest.fn(() => focused),
});

describe('releaseFieldFocus', () => {
  it('does nothing without a field', () => {
    expect(releaseFieldFocus(null)).toBe(false);
    expect(releaseFieldFocus(undefined)).toBe(false);
  });

  it('blurs a field that holds focus, and reports that it did', () => {
    const f = field(true);
    expect(releaseFieldFocus(f)).toBe(true);
    expect(f.blur).toHaveBeenCalledTimes(1);
    expect(f.isFocused).toHaveBeenCalledTimes(1);
  });

  it('leaves an unfocused field alone', () => {
    const f = field(false);
    expect(releaseFieldFocus(f)).toBe(false);
    expect(f.blur).not.toHaveBeenCalled();
  });

  it('treats a handle that cannot report focus as holding it', () => {
    // blur() on an unfocused input is a no-op, so the conservative reading still
    // cannot dismiss a keyboard that belongs to something else.
    const f = { blur: jest.fn() };
    expect(releaseFieldFocus(f)).toBe(true);
    expect(f.blur).toHaveBeenCalledTimes(1);
  });

  it('tolerates a handle with neither method', () => {
    expect(releaseFieldFocus({} as FieldHandle)).toBe(true);
    expect(releaseFieldFocusRef({ current: null })).toBe(false);
  });
});

describe('releaseFieldFocusRef', () => {
  it('reads through the ref', () => {
    const f = field(true);
    expect(releaseFieldFocusRef({ current: f })).toBe(true);
    expect(f.blur).toHaveBeenCalledTimes(1);
  });
});

describe('SearchScreen wiring', () => {
  const screen = read('src/screens/SearchScreen.tsx');

  it('releases the field when the screen is left, and before opening a title', () => {
    expect(screen).toContain('releaseFieldFocusRef');
    expect(screen).toContain('useFocusEffect');
    // The card tap that opens the movie releases the field itself, rather than
    // waiting for the transition to tear the old screen down.
    expect(screen).toMatch(/const openDetail = useCallback\(\s*\(\w+: MediaItem\) => \{\s*leaveWithFieldReleased\(\);/);
    expect(screen).toMatch(/onPress=\{openDetail\}/);
  });

  it('keeps the field a normal field', () => {
    expect(screen).toContain('returnKeyType="search"');
    expect(screen).toContain('onChangeText={setQuery}');
  });
});

describe('LiveTvScreen wiring', () => {
  // Same hazard, second instance: this field filters a channel list, and opening a channel pushes
  // the live player, which rotates the window. Leaving the movie path alone would have left the
  // keyboard popping up on the other path that reaches a player.
  const screen = read('src/screens/LiveTvScreen.tsx');

  it('releases the field on leaving the screen and before resolving a channel', () => {
    expect(screen).toContain('releaseFieldFocusRef');
    expect(screen).toContain('useFocusEffect');
    const playChannel = screen.slice(
      screen.indexOf('const playChannel = useCallback'),
      screen.indexOf('const openChannel = useCallback'),
    );
    expect(playChannel).toContain('releaseField()');
    expect(playChannel.indexOf('releaseField()')).toBeLessThan(
      playChannel.indexOf('await DaddyLiveService.getStream'),
    );
  });

  it('binds the handle to the field it is meant to release', () => {
    const at = screen.indexOf('<InputField');
    expect(at).toBeGreaterThan(-1);
    expect(screen.slice(at, at + 420)).toContain('ref={fieldRef');
  });

  it('leaves the field itself alone', () => {
    expect(screen).toContain('onChangeText={setQuery}');
    expect(screen).not.toMatch(/returnKeyType=\{?[^\n]*hidden/);
  });
});

describe('no blanket keyboard suppression was introduced', () => {
  const sources = [
    'src/screens/SearchScreen.tsx',
    'src/screens/LiveTvScreen.tsx',
    'src/screens/HomeScreen.tsx',
    'src/screens/DetailScreen.tsx',
    'src/components/AppHeader.tsx',
    'src/components/streamz/StreamZLogo.tsx',
  ];

  it.each(sources)('%s never disables the keyboard on focus', (rel) => {
    expect(read(rel)).not.toMatch(/showSoftInputOnFocus=\{false\}/);
    expect(read(rel)).not.toMatch(/\bautoFocus\b/);
  });

  it('no input in the app sets autoFocus', () => {
    // `autoFocus` is the one primitive that makes React Native pop the keyboard
    // by itself on Android — `ReactEditText.onAttachedToWindow` calls
    // `requestFocusProgrammatically()`, which shows the IME whenever
    // `showSoftInputOnFocus` is at its default. If a movie ever opens with a
    // keyboard up, an `autoFocus` prop appearing in a component file is the
    // first suspect, and this sweep is what catches it instead of an assumption.
    // Only `.tsx` is swept: a prop can only be set in JSX, and prose in `.ts`
    // modules (including this repo's own explanation of the mechanism) is not a
    // prop.
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx')) files.push(full);
      }
    };
    walk(path.join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(30);
    const withAutoFocus = files.filter((f) => /\bautoFocus\b/.test(readFileSync(f, 'utf8')));
    expect(withAutoFocus.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
