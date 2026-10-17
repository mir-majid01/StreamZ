/**
 * Owner item 9: the Android launcher icon has to be the artwork the splash
 * screen already draws, not a second copy of the Z that can drift.
 *
 * What is provable statically, and asserted here:
 *   1. one source of truth — the splash logo component and the icon generator
 *      both read `src/brand/zMarkGeometry.ts`, and the shipped foreground layer
 *      contains the same path data the component renders;
 *   2. the foreground mark fits the 66dp-of-108dp adaptive safe zone;
 *   3. no broken references — every file app.json, the adaptive-icon XML and the
 *      manifest name actually exists.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

import {
  ADAPTIVE_ICON_CANVAS_DP,
  ADAPTIVE_ICON_SAFE_DP,
  DIAGONAL_D,
  MARK_INK,
  MARK_INK_CENTER_X,
  MARK_INK_CENTER_Y,
  PLAY_HEAD_D,
  RAIL,
  adaptiveForegroundCoverage,
  adaptiveForegroundScale,
  zMarkSvg,
} from '@/src/brand/zMarkGeometry';
import { BACKGROUND } from '@/src/theme/tokens';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const has = (rel: string): boolean => existsSync(path.join(ROOT, rel));

const APP_JSON = JSON.parse(read('app.json')) as {
  expo: {
    icon: string;
    ios: { icon: string };
    android: {
      adaptiveIcon: {
        backgroundColor: string;
        foregroundImage: string;
        backgroundImage: string;
        monochromeImage: string;
      };
    };
  };
};

const RES = 'android/app/src/main/res';
const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

describe('the splash logo and the launcher icon share one mark', () => {
  it('the logo component draws the shared geometry, not its own copy', () => {
    const logo = read('src/components/streamz/StreamZLogo.tsx');
    expect(logo).toContain('@/src/brand/zMarkGeometry');
    // The duplicate literals that let icon and splash drift apart are gone.
    expect(logo).not.toMatch(/^const RAIL = /m);
    expect(logo).not.toMatch(/const DIAGONAL = /);
    expect(logo).not.toMatch(/const PLAY_HEAD = /);
    // Even the authoring box is shared, so a geometry change lands on both sides.
    expect(logo).toContain('MARK_VIEW_BOX');
    expect(logo).not.toContain('0 0 64 64');
  });

  it('the splash screen renders that component', () => {
    expect(read('src/components/splash/StreamZSplashWordmark.tsx')).toContain('StreamZLogo');
    expect(read('src/screens/SplashScreen.tsx')).toContain('StreamZSplashWordmark');
  });

  it('the icon generator rasterises the same geometry module', () => {
    const script = read('scripts/generate-brand-assets.mjs');
    expect(script).toContain('../src/brand/zMarkGeometry.ts');
    expect(script).toContain('zMarkSvg(');
    expect(script).toContain('../src/theme/tokens.ts');
    // No hand-redrawn mark left in the generator.
    expect(script).not.toContain('M14 12 H50');
    expect(script).not.toContain('M54 6 L12 56');
  });

  it('the shipped foreground layer is that geometry, verbatim', () => {
    const svg = read('assets/applogo/ic_launcher_foreground.svg');
    expect(svg).toContain(zMarkSvg('#FFFFFF', 'url(#zramp)'));
    expect(svg).toContain(DIAGONAL_D);
    expect(svg).toContain(PLAY_HEAD_D);
  });

  it('the background layer is the existing brand surface, flat', () => {
    const svg = read('assets/applogo/ic_launcher_background.svg');
    expect(svg).toContain(`fill="${BACKGROUND.base}"`);
    expect(APP_JSON.expo.android.adaptiveIcon.backgroundColor).toBe(BACKGROUND.base);
  });
});

describe('adaptive-icon safe zone', () => {
  it('derives its bounds from the primitives instead of trusting a comment', () => {
    // Rails start at the spine; the round-capped diagonal overshoots to the left
    // by half its stroke; the stroked play head reaches furthest right and top.
    expect(MARK_INK.minX).toBe(12 - RAIL / 2);
    expect(MARK_INK.maxX).toBe(56 + 1);
    expect(MARK_INK.minY).toBe(12 - 1);
    expect(MARK_INK.maxY).toBe(48 + RAIL / 2);
    // The Z leans, so its ink centre is not the middle of the authored box.
    expect(MARK_INK_CENTER_X).toBeGreaterThan(32);
    expect(MARK_INK_CENTER_Y).toBeLessThan(32);
  });

  it('fits the mark diagonal inside the 66dp circle, with headroom', () => {
    const coverage = adaptiveForegroundCoverage(adaptiveForegroundScale());
    // A rectangle clears a circular mask only if its diagonal does.
    expect(coverage.diagonalDp).toBeLessThan(ADAPTIVE_ICON_SAFE_DP);
    // Headroom, not a shrink: 8% inside the circle is the design intent, and a
    // mark under half the safe circle would read as a small icon in a big tile.
    expect(coverage.diagonalDp).toBeGreaterThan(ADAPTIVE_ICON_SAFE_DP * 0.7);
    expect(coverage.widthDp).toBeLessThan(ADAPTIVE_ICON_CANVAS_DP);
  });

  it('centres the foreground on the ink bounds, not the authored box', () => {
    const svg = read('assets/applogo/ic_launcher_foreground.svg');
    expect(svg).toContain(`translate(-${MARK_INK_CENTER_X} -${MARK_INK_CENTER_Y})`);
  });
});

describe('launcher icon references resolve', () => {
  it('every asset path app.json names exists', () => {
    const paths = [
      APP_JSON.expo.icon,
      APP_JSON.expo.ios.icon,
      APP_JSON.expo.android.adaptiveIcon.foregroundImage,
      APP_JSON.expo.android.adaptiveIcon.backgroundImage,
      APP_JSON.expo.android.adaptiveIcon.monochromeImage,
    ];
    for (const p of paths) expect(`${p}:${has(p)}`).toBe(`${p}:true`);
  });

  it('the adaptive XML names three layers, and each exists per density', () => {
    for (const xml of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      const file = `${RES}/mipmap-anydpi-v26/${xml}`;
      expect(has(file)).toBe(true);
      const body = read(file);
      for (const layer of ['background', 'foreground', 'monochrome']) {
        expect(body).toContain(`android:drawable="@mipmap/ic_launcher_${layer}"`);
      }
    }
    for (const dpi of DENSITIES) {
      for (const name of [
        'ic_launcher',
        'ic_launcher_round',
        'ic_launcher_foreground',
        'ic_launcher_background',
        'ic_launcher_monochrome',
      ]) {
        const file = `${RES}/mipmap-${dpi}/${name}.webp`;
        expect(`${file}:${has(file)}`).toBe(`${file}:true`);
      }
    }
  });

  it('the manifest points android:icon and roundIcon at the adaptive mipmaps', () => {
    const manifest = read(MANIFEST);
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:roundIcon="@mipmap/ic_launcher_round"');
    expect(manifest).toContain('android:banner="@drawable/tv_banner"');
    expect(has(`${RES}/drawable-xhdpi/tv_banner.png`)).toBe(true);
  });

  it('resolves every icon resource the adaptive XMLs and the manifest name', () => {
    // Scope: the launcher-icon surface this change touches. `@drawable/…` names
    // inside `rn_edit_text_material.xml` (`abc_textfield_*`) are AppCompat
    // resources that come from the AAR at build time, so they are deliberately
    // not asserted against this project's res tree.
    const imageResolvable = (name: string): boolean =>
      has(`${RES}/mipmap-anydpi-v26/${name}.xml`) ||
      has(`${RES}/drawable/${name}.xml`) ||
      has(`${RES}/drawable/${name}.png`) ||
      DENSITIES.some(
        (dpi) =>
          has(`${RES}/mipmap-${dpi}/${name}.webp`) ||
          has(`${RES}/drawable-${dpi}/${name}.png`),
      );

    const named: string[] = [];
    for (const file of readdirSync(path.join(ROOT, `${RES}/mipmap-anydpi-v26`))) {
      if (!file.endsWith('.xml')) continue;
      for (const m of read(`${RES}/mipmap-anydpi-v26/${file}`).matchAll(/@mipmap\/([A-Za-z0-9_.]+)/g)) {
        named.push(m[1]);
      }
    }
    for (const m of read(MANIFEST).matchAll(/android:(?:icon|roundIcon|banner)="@\w+\/([A-Za-z0-9_.]+)/g)) {
      named.push(m[1]);
    }

    // The three layers plus the two legacy aliases and the TV banner — if any of
    // these is missing, aapt fails and the owner sees a blank/absent icon.
    expect(new Set(named).size).toBeGreaterThanOrEqual(5);
    for (const name of named) {
      expect(`${name}:${imageResolvable(name)}`).toBe(`${name}:true`);
    }
  });
});
