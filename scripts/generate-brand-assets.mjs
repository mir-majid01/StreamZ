/**
 * Generates the StreamZ launcher icon set (PRD §10) from the same geometric Z
 * the in-app logo draws, so the icon and the wordmark never drift apart.
 * Run: node scripts/generate-brand-assets.mjs
 * Outputs into assets/applogo/ (paths referenced by app.json).
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'applogo');

// The mark, in a 64-unit box: two bars + the overshooting "stream" diagonal.
// `stroke` colours the bars; `diagonal` carries the accent ramp.
const mark = (diagonal, bars = '#FFFFFF') => `
  <path d="M14 12 H50 M14 52 H50" stroke="${bars}" stroke-width="9" fill="none"/>
  <path d="M54 6 L12 56" stroke="${diagonal}" stroke-width="11" stroke-linecap="round" fill="none"/>
`;

const withRamp = (inner) => `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <defs>
      <linearGradient id="zramp" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FF3045"/>
        <stop offset="0.55" stop-color="#E50914"/>
        <stop offset="1" stop-color="#B20710"/>
      </linearGradient>
    </defs>
    ${inner}
  </svg>
`;

// Legacy full-bleed icon: dark base, ambient glow, mark at ~60%.
const fullIcon = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs>
      <radialGradient id="glow" cx="0.5" cy="0.42" r="0.62">
        <stop offset="0" stop-color="#3D0810" stop-opacity="0.9"/>
        <stop offset="0.55" stop-color="#16060B" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#050505" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="zramp" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FF3045"/>
        <stop offset="0.55" stop-color="#E50914"/>
        <stop offset="1" stop-color="#B20710"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="#050505"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
    <g transform="translate(512 512) scale(8.6) translate(-32 -32)">
      ${mark('url(#zramp)')}
    </g>
  </svg>
`;

// Adaptive foreground: mark inside the 66% safe zone, nothing else.
const foregroundIcon = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="zramp" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#FF3045"/>
        <stop offset="0.55" stop-color="#E50914"/>
        <stop offset="1" stop-color="#B20710"/>
      </linearGradient>
    </defs>
    <g transform="translate(512 512) scale(6.4) translate(-32 -32)">
      ${mark('url(#zramp)')}
    </g>
  </svg>
`;

// Adaptive background layer: near-black with the faintest red bloom.
const backgroundIcon = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <defs>
      <radialGradient id="glow" cx="0.5" cy="0.45" r="0.7">
        <stop offset="0" stop-color="#26060C" stop-opacity="0.85"/>
        <stop offset="0.6" stop-color="#0D0508" stop-opacity="0.4"/>
        <stop offset="1" stop-color="#050505" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1024" height="1024" fill="#050505"/>
    <rect width="1024" height="1024" fill="url(#glow)"/>
  </svg>
`;

// Monochrome layer: white mark on transparent (Android 13+ themed icons).
const monochromeIcon = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
    <g transform="translate(512 512) scale(6.4) translate(-32 -32)">
      ${mark('#FFFFFF')}
    </g>
  </svg>
`;

const write = async (name, svg) => {
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, name));
  console.log(`✓ ${name}`);
};

await write('ic_launcher.png', fullIcon(1024));
await write('ic_launcher_foreground.png', foregroundIcon(1024));
await write('ic_launcher_background.png', backgroundIcon(1024));
await write('ic_launcher_monochrome.png', monochromeIcon(1024));
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
  await writeWebp(dpi, 'ic_launcher.webp', fullIcon(size * 2), size);
  await writeWebp(dpi, 'ic_launcher_round.webp', fullIcon(size * 2), size, true);
}
for (const [dpi, size] of Object.entries(LAYER_SIZES)) {
  await writeWebp(dpi, 'ic_launcher_foreground.webp', foregroundIcon(size * 2), size);
  await writeWebp(dpi, 'ic_launcher_background.webp', backgroundIcon(size * 2), size);
  await writeWebp(dpi, 'ic_launcher_monochrome.webp', monochromeIcon(size * 2), size);
}
console.log('Android density set written to android/app/src/main/res/');
