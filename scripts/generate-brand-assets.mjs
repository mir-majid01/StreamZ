/**
 * Generates the StreamZ launcher icon set (PRD §10) from `zMarkGeometry.ts` —
 * the exact numbers `src/components/streamz/StreamZLogo.tsx` draws, which is the
 * logo the splash animates. No mark is redrawn here; the launcher art is the
 * splash artwork rasterised, which is the point (owner item 9).
 *
 * Run: node scripts/generate-brand-assets.mjs
 *
 * Writes:
 *   - assets/applogo/*.png            (paths referenced by app.json)
 *   - assets/applogo/*.svg            (the SVG each layer was rasterised from,
 *                                      so a test can diff the shipped icon
 *                                      against the shared geometry)
 *   - android/app/src/main/res/mipmap-<dpi>/  (the committed bare-android set)
 */
import sharp from 'sharp';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  ADAPTIVE_ICON_CANVAS_PX,
  adaptiveForegroundCoverage,
  adaptiveForegroundScale,
  adaptiveForegroundTransform,
  zMarkSvg,
} from '../src/brand/zMarkGeometry.ts';
import { BACKGROUND, MARK_RAMP } from '../src/theme/tokens.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'applogo');

const RAMP_STOPS = `
        <stop offset="0" stop-color="${MARK_RAMP.bright}"/>
        <stop offset="1" stop-color="${MARK_RAMP.deep}"/>`;

const RAMP_DEFS = `
    <defs>
      <linearGradient id="zramp" x1="0" y1="0" x2="1" y2="1">${RAMP_STOPS}
      </linearGradient>
    </defs>`;

/**
 * The mark, centred on its own ink bounds at `scale`, inside the 1024-unit
 * adaptive canvas. The ink of the Z is not at the middle of its authoring box —
 * it leans — so the translate comes from the derived centre; hardcoding (32, 32)
 * is what makes a leaning mark sit visibly off-centre in a round mask.
 */
const markGroup = (scale, bars, diagonal) => {
  const t = adaptiveForegroundTransform(scale);
  return `
    <g transform="translate(${t.translateX} ${t.translateY}) scale(${t.scale}) translate(${t.inkOffsetX} ${t.inkOffsetY})">
      ${zMarkSvg(bars, diagonal)}
    </g>`;
};

// Legacy full-bleed icon (pre-API-26 launchers, iOS, the TV banner the config
// plugin composites from it): dark base, ambient glow, mark at ~62% of the canvas.
const FULL_BLEED_SCALE = 10.6;
const fullIcon = () => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" viewBox="0 0 ${ADAPTIVE_ICON_CANVAS_PX} ${ADAPTIVE_ICON_CANVAS_PX}">
    <defs>
      <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="#3D0810" stop-opacity="0.9"/>
        <stop offset="0.55" stop-color="#16060B" stop-opacity="0.55"/>
        <stop offset="1" stop-color="${BACKGROUND.base}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="zramp" x1="0" y1="0" x2="1" y2="1">${RAMP_STOPS}
      </linearGradient>
    </defs>
    <rect width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" fill="${BACKGROUND.base}"/>
    <rect width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" fill="url(#glow)"/>${markGroup(
      FULL_BLEED_SCALE,
      '#FFFFFF',
      'url(#zramp)',
    )}
  </svg>`;

/**
 * Adaptive foreground: the mark and nothing else, scaled so its diagonal fits
 * the 66dp-of-108dp safe circle the launcher keeps after masking.
 */
const foregroundIcon = () => {
  const scale = adaptiveForegroundScale();
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" viewBox="0 0 ${ADAPTIVE_ICON_CANVAS_PX} ${ADAPTIVE_ICON_CANVAS_PX}">${RAMP_DEFS}${markGroup(
    scale,
    '#FFFFFF',
    'url(#zramp)',
  )}
  </svg>`;
};

/**
 * Adaptive background: flat brand surface — `BACKGROUND.base`, the same value
 * app.json declares for `adaptiveIcon.backgroundColor`, the native launch
 * window (`colors.xml/splashscreen_background`) and the JS app background.
 * A flat surface keeps the mark readable at every mask shape; a gradient here
 * would be new visual language, not the existing one.
 */
const backgroundIcon = () => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" viewBox="0 0 ${ADAPTIVE_ICON_CANVAS_PX} ${ADAPTIVE_ICON_CANVAS_PX}">
    <rect width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" fill="${BACKGROUND.base}"/>
  </svg>`;

/** Monochrome layer: white mark on transparent (Android 13+ themed icons). */
const monochromeIcon = () => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${ADAPTIVE_ICON_CANVAS_PX}" height="${ADAPTIVE_ICON_CANVAS_PX}" viewBox="0 0 ${ADAPTIVE_ICON_CANVAS_PX} ${ADAPTIVE_ICON_CANVAS_PX}">${markGroup(
    adaptiveForegroundScale(),
    '#FFFFFF',
    '#FFFFFF',
  )}
  </svg>`;

const svgByName = {
  'ic_launcher': fullIcon(),
  'ic_launcher_foreground': foregroundIcon(),
  'ic_launcher_background': backgroundIcon(),
  'ic_launcher_monochrome': monochromeIcon(),
};

mkdirSync(OUT, { recursive: true });

const write = async (name, svg) => {
  writeFileSync(`${path.join(OUT, name)}.svg`, svg.trimStart(), 'utf8');
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `${name}.png`));
  console.log(`✓ ${name}.png`);
};

for (const [name, svg] of Object.entries(svgByName)) {
  await write(name, svg);
}
console.log('Icon set written to assets/applogo/');

// ── Bare-android density set ────────────────────────────────────────────────
// The committed android/ project serves the adaptive layers from res/mipmap-*
// webps (see mipmap-anydpi-v26/ic_launcher.xml), so the same art is rendered
// at every launcher density. Sizes are the standard launcher grid values.
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const LAUNCHER_SIZES = { 'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192 };
const LAYER_SIZES = { 'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432 };
const roundMask = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

const writeWebp = async (dpi, name, svg, size, round = false) => {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  if (round) {
    img = sharp(
      await img.composite([{ input: roundMask(size), blend: 'dest-in' }]).webp().toBuffer(),
    );
  }
  await img.webp().toFile(path.join(ANDROID_RES, `mipmap-${dpi}`, name));
  console.log(`✓ mipmap-${dpi}/${name}`);
};

for (const [dpi, size] of Object.entries(LAUNCHER_SIZES)) {
  await writeWebp(dpi, 'ic_launcher.webp', svgByName['ic_launcher'], size);
  await writeWebp(dpi, 'ic_launcher_round.webp', svgByName['ic_launcher'], size, true);
}
for (const [dpi, size] of Object.entries(LAYER_SIZES)) {
  await writeWebp(dpi, 'ic_launcher_foreground.webp', svgByName['ic_launcher_foreground'], size);
  await writeWebp(dpi, 'ic_launcher_background.webp', svgByName['ic_launcher_background'], size);
  await writeWebp(dpi, 'ic_launcher_monochrome.webp', svgByName['ic_launcher_monochrome'], size);
}
console.log('Android density set written to android/app/src/main/res/');

// Printed so the safe-zone claim is checkable in the build log, not just in code.
const coverage = adaptiveForegroundCoverage(adaptiveForegroundScale());
console.log(
  `foreground mark: ${coverage.widthDp.toFixed(1)}×${coverage.heightDp.toFixed(1)}dp ` +
    `(diagonal ${coverage.diagonalDp.toFixed(1)}dp, safe circle 66dp of 108dp)`,
);
