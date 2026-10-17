/**
 * Owner item P3, native half: "no flash of the wrong theme", and one intentional launch
 * experience from the moment the icon is tapped to the first app screen.
 *
 * What is provable statically is asserted here — that every surface the launch passes through
 * is the *same colour*, that the platform's own splash is pinned rather than inferred, and that
 * the stack no longer slides the app in sideways out of a crossfading splash. What it is
 * *actually* like to look at still needs a device: no test in this file claims to have seen it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { AUTH, BACKGROUND } from '@/src/theme/tokens';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const RES = 'android/app/src/main/res';
const STYLES = `${RES}/values/styles.xml`;
const COLORS = `${RES}/values/colors.xml`;
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

/** The single value every launch surface is supposed to agree on. */
const APP_INK = BACKGROUND.base;

const colorResource = (name: string): string => {
  const body = read(COLORS);
  const m = body.match(new RegExp(`<color name="${name}">#([0-9a-fA-F]{6})</color>`));
  if (!m) throw new Error(`no <color name="${name}"> in colors.xml`);
  return `#${m[1].toLowerCase()}`;
};

const itemOf = (style: string, attr: string): string | undefined => {
  const body = read(STYLES);
  const block = styleBlock(style, body);
  // The attribute may carry `tools:targetApi`, so the name is not immediately followed by `>`.
  const m = block?.match(new RegExp(`<item name="${attr}"[^>]*>(.*?)</item>`));
  return m?.[1];
};

const styleBlock = (name: string, body: string): string | undefined => {
  const start = body.indexOf(`<style name="${name}"`);
  if (start < 0) return undefined;
  const end = body.indexOf('</style>', start);
  return body.slice(start, end);
};

describe('the launch window and the first React frame are the same colour', () => {
  it('app.json, the tokens, and both native colours all say #050505', () => {
    const appJson = JSON.parse(read('app.json'));
    expect(APP_INK).toBe('#050505');
    expect(appJson.expo.backgroundColor).toBe(APP_INK);
    expect(appJson.expo.android.adaptiveIcon.backgroundColor).toBe(APP_INK);
    expect(colorResource('activityBackground')).toBe(APP_INK);
    expect(colorResource('splashscreen_background')).toBe(APP_INK);
  });

  it('both themes paint that colour as the window background', () => {
    expect(itemOf('AppTheme', 'android:windowBackground')).toBe('@color/activityBackground');
    expect(itemOf('Theme.App.SplashScreen', 'android:windowBackground')).toBe(
      '@color/splashscreen_background',
    );
  });

  it('pins the Android 12+ system splash background instead of relying on a default', () => {
    // The documented fallback is "the theme's windowBackground, if it is a single colour".
    // That is true here, but it is an inference the platform makes about a theme this app
    // re-points at runtime (MainActivity installs AppTheme in onCreate before super.onCreate),
    // so the value is stated on both themes and cannot depend on which one was consulted.
    for (const style of ['AppTheme', 'Theme.App.SplashScreen']) {
      expect(itemOf(style, 'android:windowSplashScreenBackground')).toBe(
        '@color/splashscreen_background',
      );
    }
  });

  it('overrides the DayNight light background the app is not going to render in', () => {
    // `AppTheme` inherits `Theme.AppCompat.DayNight.NoActionBar`, whose `colorBackground`
    // resolves to the light material value on a device in system light mode. React Native's
    // Appearance is pinned to dark in `index.ts` and global.css makes dark the unconditional
    // :root, but neither of those reaches an Android resource lookup that happens before the
    // first React frame exists.
    expect(itemOf('AppTheme', 'android:colorBackground')).toBe('@color/activityBackground');
  });

  it('keeps the system bars transparent so no bar is a different colour from the window', () => {
    expect(itemOf('AppTheme', 'android:statusBarColor')).toBe('@android:color/transparent');
    expect(itemOf('AppTheme', 'android:navigationBarColor')).toBe('@android:color/transparent');
  });

  it('does not invent a splash icon: the launcher mark and the ident are one geometry', () => {
    // With no `windowSplashScreenAnimatedIcon` the system uses the adaptive launcher icon, which
    // `brand-launcher-assets.test.ts` already pins to the same Z-mark path the wordmark draws.
    expect(styleBlock('Theme.App.SplashScreen', read(STYLES))).not.toMatch(
      'windowSplashScreenAnimatedIcon',
    );
  });
});

describe('the manifest launch path is the one the code expects', () => {
  it('the activity starts in the splash theme', () => {
    expect(read(MANIFEST)).toMatch(
      /android:name="\.MainActivity"[^>]*android:theme="@style\/Theme\.App\.SplashScreen"/,
    );
  });

  it('the config plugin that writes those lines is not silently rewriting them at build time', () => {
    // `android/` is hand-maintained here, so nothing in the plugin list may regenerate themes
    // or the manifest. If a splash plugin is ever added, these files stop being the source of
    // truth and this test should be retired in the same commit.
    const appJson = JSON.parse(read('app.json'));
    const plugins = JSON.stringify(appJson.expo.plugins);
    expect(plugins).not.toContain('expo-splash-screen');
  });

  it('the app really does depend on no JS-driven splash module', () => {
    const pkg = JSON.parse(read('package.json'));
    // Stated as a fact this test protects: the readiness signal for the native layer is the
    // platform's own first-drawn-frame dismissal, so `hideAsync` has nothing to gate.
    expect(pkg.dependencies['expo-splash-screen']).toBeUndefined();
    expect(read('src/screens/SplashScreen.tsx')).not.toMatch(/expo-splash-screen/);
  });
});

describe('the handoff into the app is one consistent transition', () => {
  const navigator = read('src/navigation/AppNavigator.tsx');

  it('every gate screen, Main included, uses the shared handoff options', () => {
    expect(navigator).toContain('const gateOptions = useGateScreenOptions(reduced)');
    for (const screen of ['Splash', 'Login', 'Subscription', 'Blocked', 'Main']) {
      expect(navigator).toMatch(
        new RegExp(`<Stack.Screen[^/]*name="${screen}"[^/]*options=\\{gateOptions\\}`),
      );
    }
  });

  it('no gate screen is left on the stack default slide', () => {
    // `Main` used to inherit `slide_from_right` from screenOptions while `Login` faded, so the
    // same splash handoff looked like two different things.
    const mainScreen = read('src/navigation/AppNavigator.tsx').match(
      /<Stack\.Screen name="Main"[^>]*>/,
    )?.[0];
    expect(mainScreen).toContain('options={gateOptions}');
    expect(mainScreen).not.toMatch(/animation: 'slide_from_right'/);
    expect(navigator).toContain('animation: handoffAnimation(reduced)');
  });

  it('reduce-motion removes the transition instead of shortening it', () => {
    expect(navigator).toContain('usePrefersReducedMotion()');
    expect(navigator).toContain("from '@/src/utils/startupSequence'");
  });

  it('the orientation contract is read from the live window, not frozen at module load', () => {
    expect(navigator).toContain('isTablet(width, height)');
    expect(navigator).toContain('useWindowDimensions()');
    expect(navigator).not.toMatch(/^const flexibleDevice = /m);
  });

  it('the gate sync compares against the settled route, and will not consume a verdict it cannot check', () => {
    expect(navigator).toContain('<GateSync currentRouteName={routeName} />');
    expect(navigator).toContain('gateResetFor(sessionRoute, currentRouteName)');
    expect(navigator).toContain('if (currentRouteName === undefined) return;');
  });

  it('in-app pushes still slide, and the player keeps its own contract', () => {
    expect(navigator).toContain("animation: 'slide_from_right'");
    // Pinned by `player-chrome-restore.test.ts` too: the immersive-chrome fix was made in the
    // lifecycle, not by taking the fade away so nobody sees the relayout. Renaming the const or
    // dropping the fade here would break that diagnosis, so it is asserted on both sides.
    expect(navigator).toMatch(/const playerOrientation = 'landscape'/);
    expect(navigator).toMatch(/animation: 'fade', orientation: playerOrientation/);
  });
});

describe('the auth layer records hydration as its own fact', () => {
  const provider = read('src/firebase/auth/SessionProvider.tsx');

  it('marks the session hydrated only when Firebase itself reports', () => {
    expect(provider).toContain('acceptAuthReport(firebaseUser,');
    expect(provider).toContain('onAuthStateChanged(getAuth()');
    expect(provider).toContain('authHydrated');
    expect(provider).toContain('authInitFailed');
  });

  it('a Firebase-less build is a named failure, not a silent one', () => {
    expect(provider).toMatch(/if \(!ensureFirebase\(\)\) \{[\s\S]*?failAuthInit\('firebase-unconfigured'\)/);
  });

  it('the watchdog is bounded by the shared budget, not by a number invented here', () => {
    expect(provider).toContain('AUTH_HYDRATION_BUDGET_MS');
    expect(provider).toContain('didAuthHydrationTimeOut');
    // And it is cleaned up, so an unmount cannot fire a state update into nothing.
    expect(provider).toContain('clearTimeout(watchdog)');
  });

  it('a retry after the budget can recover a slow-but-live session', () => {
    expect(provider).toContain("acceptAuthReport(getAuth().currentUser, 'retry')");
  });
});

describe('the auth screens stay on their own ink without touching the launch surface', () => {
  it('records the seam that is a design decision, not a bug', () => {
    // Login and Subscription paint `AUTH.ink` (#070506) while the splash and the native window
    // paint `BACKGROUND.base` (#050505). The two are one step apart on every channel, and the
    // handoff is a crossfade, so the seam is intentional per the auth mockups. Pinned here so a
    // future palette edit cannot turn it into an unremarked three-way mismatch.
    expect(AUTH.ink).not.toBe(APP_INK);
    expect(AUTH.ink).toBe('#070506');
  });
});
