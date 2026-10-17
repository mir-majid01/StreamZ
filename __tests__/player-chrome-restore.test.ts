/**
 * Owner item P2: "returning from live playback leaves the bottom tab bar glitching / the wrong
 * tab highlighted."
 *
 * Traced root cause (see `src/components/player/useImmersivePlayerChrome.ts` for the long form):
 * both players restored orientation + system bars only from the cleanup of a mount effect. That
 * cleanup runs when `react-native-screens` *destroys* the popped screen, which is after the dismiss
 * transition has begun — so with `animation: 'fade'` the previous screen is already visible while
 * the navigation bar reappears and `insets.bottom` changes under it. The tab bar re-lays itself out
 * on screen: the selector appears to jump.
 *
 * The fix moves the give-back to `beforeRemove`, the event that starts the exit, so the insets have
 * settled before the reveal. The movie path had the identical defect, so both screens now share one
 * hook — fixing live playback alone would have left the same bug one screen away.
 *
 * These tests cover the behaviour of the two chrome seams, and pin the wiring that cannot be
 * rendered here: the lifecycle event used, and the absence of the delay/re-render class of workaround.
 */
import { readFileSync } from 'fs';
import path from 'path';

const mockChromeCalls: string[] = [];

jest.mock('@/src/utils/orientation', () => ({
  forceLandscape: async () => {
    mockChromeCalls.push('landscape');
  },
  restoreOrientation: async () => {
    mockChromeCalls.push('restore-orientation');
  },
}));

jest.mock('expo-navigation-bar', () => ({
  NavigationBar: {
    setHidden: async (hidden: boolean) => {
      mockChromeCalls.push(`nav-bar:${hidden ? 'hidden' : 'visible'}`);
    },
  },
}));

import { Platform, StatusBar } from 'react-native';
import {
  giveBackPlayerChrome,
  takePlayerChrome,
} from '@/src/components/player/useImmersivePlayerChrome';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const onAndroid = (body: () => void): void => {
  const original = Platform.OS;
  (Platform as unknown as { OS: string }).OS = 'android';
  try {
    body();
  } finally {
    (Platform as unknown as { OS: string }).OS = original;
  }
};

describe('player chrome seams', () => {
  beforeEach(() => {
    mockChromeCalls.length = 0;
  });

  it('takes landscape and hides the Android navigation bar', () => {
    onAndroid(() => takePlayerChrome());
    expect(mockChromeCalls).toEqual(['landscape', 'nav-bar:hidden']);
  });

  it('gives the orientation back first, then both Android system bars', () => {
    const setHidden = jest.spyOn(StatusBar, 'setHidden').mockImplementation(() => {});
    onAndroid(() => giveBackPlayerChrome());
    expect(mockChromeCalls).toEqual([
      'restore-orientation',
      'nav-bar:visible',
    ]);
    // The declarative <StatusBar hidden/> can leave the bar hidden after the pop, which
    // arrives downstream as insets.top === 0. The imperative undo is the point.
    expect(setHidden).toHaveBeenCalledWith(false, 'fade');
    setHidden.mockRestore();
  });

  it('leaves the system bars alone on iOS, where they are not ours to hide', () => {
    const setHidden = jest.spyOn(StatusBar, 'setHidden').mockImplementation(() => {});
    const body = () => {
      takePlayerChrome();
      giveBackPlayerChrome();
    };
    const original = Platform.OS;
    (Platform as unknown as { OS: string }).OS = 'ios';
    try {
      body();
    } finally {
      (Platform as unknown as { OS: string }).OS = original;
    }
    expect(mockChromeCalls).toEqual(['landscape', 'restore-orientation']);
    expect(setHidden).not.toHaveBeenCalled();
    setHidden.mockRestore();
  });
});

describe('useImmersivePlayerChrome wiring', () => {
  const hook = read('src/components/player/useImmersivePlayerChrome.ts');

  it('gives the chrome back on the event that starts the exit', () => {
    expect(hook).toContain("addListener('beforeRemove'");
    expect(hook).toMatch(
      /navigation\.addListener\('beforeRemove', \(\) => \{\s*giveBackPlayerChrome\(\);/,
    );
  });

  it('keeps the unmount cleanup as the reset safety net, and unsubscribes first', () => {
    // navigationRef.reset() destroys a screen without firing beforeRemove for it, so the cleanup
    // has to give the chrome back too. A screen left holding a landscape lock is the worse failure.
    expect(hook).toMatch(
      /return \(\) => \{\s*unsubscribe\(\);\s*giveBackPlayerChrome\(\);\s*\};/,
    );
  });

  it('takes the chrome once on mount, not on every navigation change', () => {
    expect(hook).toMatch(/takePlayerChrome\(\);\s*\}, \[\]\);/);
  });
});

describe('neither player keeps its own copy of the chrome effect', () => {
  it.each(['src/screens/PlayerScreen.tsx', 'src/screens/LivePlayerScreen.tsx'])(
    '%s uses the shared hook and holds no chrome calls of its own',
    (rel) => {
      const screen = read(rel);
      expect(screen).toContain('useImmersivePlayerChrome(navigation)');
      expect(screen).not.toMatch(/\bforceLandscape\b/);
      expect(screen).not.toMatch(/\brestoreOrientation\b/);
      expect(screen).not.toMatch(/\bNavigationBar\b/);
      expect(screen).not.toMatch(/StatusBar\.setHidden/);
    },
  );
});

describe('no delay or forced-rerender workaround was used instead of the lifecycle fix', () => {
  // The tempting wrong fix: `setTimeout(giveBack, 300)` guessed at the length of the dismiss
  // animation, or a state bump to force the tab bar to re-measure. Both hide the symptom and both
  // break the moment the animation duration changes or a device is slower than the guess.
  // The two players are absent from this list on purpose — they do hold timers (the scraper
  // timeout, the bounded playback retry) — and they are covered instead by the assertion above that
  // neither one contains any restore call that could be deferred.
  const sources = [
    'src/components/player/useImmersivePlayerChrome.ts',
    'src/navigation/TabNavigator.tsx',
    'src/navigation/AppNavigator.tsx',
  ];

  it.each(sources)('%s schedules no deferred restore', (rel) => {
    const source = read(rel);
    expect(source).not.toMatch(/\bsetTimeout\(/);
    expect(source).not.toMatch(/\brequestAnimationFrame\(/);
    expect(source).not.toMatch(/\binteractionMinTime\b|\bunstable_/);
  });

  it('keeps the exit animation and the player orientation it was diagnosed under', () => {
    const navigator = read('src/navigation/AppNavigator.tsx');
    expect(navigator).toContain("name=\"Player\"");
    expect(navigator).toMatch(/animation: 'fade', orientation: playerOrientation/);
    // The bug was fixed in the lifecycle, not by taking the fade away so nobody sees the relayout.
    expect(navigator).toMatch(/const playerOrientation = 'landscape'/);
  });
});
