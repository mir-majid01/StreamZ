/**
 * The StreamZ Z, as data.
 *
 * Two consumers, one source of truth:
 *   - `src/components/streamz/StreamZLogo.tsx` draws these numbers as SVG
 *     elements. That is the logo the splash animates
 *     (`src/components/splash/StreamZSplashWordmark.tsx` renders `StreamZLogo`),
 *     so this module *is* the splash artwork.
 *   - `scripts/generate-brand-assets.mjs` rasterises the same numbers into the
 *     Android launcher layers, so the app icon is the splash logo rather than a
     second, hand-redrawn copy of it that can drift.
 *
 * `__tests__/brand-launcher-assets.test.ts` fails if either consumer stops
 * importing this file, if the ink bounds stop matching the primitives, or if the
 * foreground mark grows out of the adaptive-icon safe zone.
 *
 * Geometry is authored in a 64×64 box with the design's translate baked into the
 * coordinates, so every consumer scales one mark without a group transform.
 * Rails are `RAIL` units thick and the diagonal overshoots both — that is what
 * keeps the Z legible at 24px, the smallest size the spec ships.
 */

// ── Authoring box ────────────────────────────────────────────────────────────
export const MARK_BOX = 64;
/** The `viewBox` every consumer draws into — the component and the rasteriser. */
export const MARK_VIEW_BOX = `0 0 ${MARK_BOX} ${MARK_BOX}`;

/** Rail thickness, in authoring units. */
export const RAIL = 8;
/** Corner radius on the rail ends. */
export const RAIL_RADIUS = 2;
/** x every rail starts at — the spine of the Z. */
export const SPINE_X = 8;
/** y each rail sits on (its centre line). */
export const TOP_Y = 20;
export const BOTTOM_Y = 48;
/** x each rail ends at; the base overshoots the top, which is the "stream" lean. */
export const TOP_END = 42;
export const BOTTOM_END = 52;

/** The diagonal, as endpoints plus the path string they produce. */
export const DIAGONAL_FROM = { x: 48, y: 26 } as const;
export const DIAGONAL_TO = { x: 12, y: 44 } as const;
export const DIAGONAL_D = `M${DIAGONAL_FROM.x} ${DIAGONAL_FROM.y} L${DIAGONAL_TO.x} ${DIAGONAL_TO.y}`;
/**
 * Rounded *up* from the true length (hypot(36, 18) = 40.25) so the draw-in dash
 * never leaves a stub of unlit stroke at the end of the sweep.
 */
export const DIAGONAL_LENGTH = 41;

/** The play head: the top rail's end becomes a forward-pointing triangle. */
export const PLAY_HEAD_POINTS = [
  { x: 42, y: 12 },
  { x: 56, y: 20 },
  { x: 42, y: 28 },
] as const;
export const PLAY_HEAD_D = `M${PLAY_HEAD_POINTS[0].x} ${PLAY_HEAD_POINTS[0].y} L${PLAY_HEAD_POINTS[1].x} ${PLAY_HEAD_POINTS[1].y} L${PLAY_HEAD_POINTS[2].x} ${PLAY_HEAD_POINTS[2].y} Z`;
/** The play head is stroked as well as filled, which fattens its corners. */
export const PLAY_HEAD_STROKE = 2;

// ── Ink bounds ───────────────────────────────────────────────────────────────
const halfRail = RAIL / 2;
const diagonalCap = RAIL / 2; // round cap on a RAIL-wide stroke
const playHeadSpread = PLAY_HEAD_STROKE / 2;
const playHeadXs = PLAY_HEAD_POINTS.map((p) => p.x);
const playHeadYs = PLAY_HEAD_POINTS.map((p) => p.y);
const diagonalXs = [DIAGONAL_FROM.x, DIAGONAL_TO.x];
const diagonalYs = [DIAGONAL_FROM.y, DIAGONAL_TO.y];

/**
 * The rectangle the mark actually paints, derived from the primitives above
 * (rails + overshooting diagonal caps + the stroked play head) rather than typed
 * by hand, so it cannot quietly fall out of step with a geometry change.
 */
export const MARK_INK = {
  minX: Math.min(SPINE_X, ...diagonalXs.map((x) => x - diagonalCap)),
  minY: Math.min(
    TOP_Y - halfRail,
    ...diagonalYs.map((y) => y - diagonalCap),
    ...playHeadYs.map((y) => y - playHeadSpread),
  ),
  maxX: Math.max(
    TOP_END,
    BOTTOM_END,
    ...diagonalXs.map((x) => x + diagonalCap),
    ...playHeadXs.map((x) => x + playHeadSpread),
  ),
  maxY: Math.max(
    BOTTOM_Y + halfRail,
    ...diagonalYs.map((y) => y + diagonalCap),
    ...playHeadYs.map((y) => y + playHeadSpread),
  ),
} as const;

export const MARK_INK_WIDTH = MARK_INK.maxX - MARK_INK.minX;
export const MARK_INK_HEIGHT = MARK_INK.maxY - MARK_INK.minY;
/** Centre of the painted rect — not (32, 32). The Z leans, so it has to be
 * re-centred on its own ink before it goes into a circular launcher mask. */
export const MARK_INK_CENTER_X = (MARK_INK.minX + MARK_INK.maxX) / 2;
export const MARK_INK_CENTER_Y = (MARK_INK.minY + MARK_INK.maxY) / 2;
/** Worst-case extent: a rect fits a circle only if its diagonal does. */
export const MARK_INK_DIAGONAL = Math.hypot(MARK_INK_WIDTH, MARK_INK_HEIGHT);

// ── Adaptive-icon safe zone ──────────────────────────────────────────────────
/**
 * Google's adaptive-icon grid: a 108×108dp canvas whose outer edge may be masked
 * away by the launcher, leaving a 66dp-diameter circle that is guaranteed
 * visible. Anything outside it can be cropped.
 */
export const ADAPTIVE_ICON_CANVAS_DP = 108;
export const ADAPTIVE_ICON_SAFE_DP = 66;
/** Working resolution the generator rasterises at; the canvas maps to 1024 units. */
export const ADAPTIVE_ICON_CANVAS_PX = 1024;
/** Headroom kept inside the safe circle, so no stroke sits on the mask edge. */
export const ADAPTIVE_ICON_SAFE_FILL = 0.92;

/** The padded safe circle, in foreground-canvas units. */
export function adaptiveSafeCirclePx(
  fill: number = ADAPTIVE_ICON_SAFE_FILL,
): number {
  return (ADAPTIVE_ICON_SAFE_DP * ADAPTIVE_ICON_CANVAS_PX * fill) / ADAPTIVE_ICON_CANVAS_DP;
}

/**
 * Scale that puts the mark's *diagonal* inside the padded safe circle, so even
 * the play head's corner survives a circular mask. The canvas is 1024 units for
 * 108dp, hence the conversion back to dp inside the coverage helper.
 */
export function adaptiveForegroundScale(
  fill: number = ADAPTIVE_ICON_SAFE_FILL,
): number {
  return adaptiveSafeCirclePx(fill) / MARK_INK_DIAGONAL;
}

/**
 * The transform that puts the mark's *ink centre* on the canvas centre at
 * `scale`. The authored box is not the ink box, so `inkOffsetX/Y` are what
 * actually centre the drawing — using the box centre instead leaves a leaning
 * mark visibly off-centre inside a round mask.
 */
export function adaptiveForegroundTransform(
  scale: number,
): {
  translateX: number;
  translateY: number;
  scale: number;
  inkOffsetX: number;
  inkOffsetY: number;
} {
  return {
    translateX: ADAPTIVE_ICON_CANVAS_PX / 2,
    translateY: ADAPTIVE_ICON_CANVAS_PX / 2,
    scale,
    inkOffsetX: -MARK_INK_CENTER_X,
    inkOffsetY: -MARK_INK_CENTER_Y,
  };
}

/**
 * How big the painted mark ends up on the 108dp canvas. The regression test
 * reads these to prove the safe zone holds; `diagonalDp` over 66 would crop.
 */
export function adaptiveForegroundCoverage(scale: number): {
  widthDp: number;
  heightDp: number;
  diagonalDp: number;
} {
  const toDp = ADAPTIVE_ICON_CANVAS_DP / ADAPTIVE_ICON_CANVAS_PX;
  return {
    widthDp: MARK_INK_WIDTH * scale * toDp,
    heightDp: MARK_INK_HEIGHT * scale * toDp,
    diagonalDp: MARK_INK_DIAGONAL * scale * toDp,
  };
}

// ── The mark as SVG ──────────────────────────────────────────────────────────
/**
 * The mark painted as an SVG fragment in authoring coordinates. Rasterisers
 * (`scripts/generate-brand-assets.mjs`) wrap it in a scale/translate group; the
 * React component draws the same four shapes as react-native-svg elements.
 *
 * `bars` colours the two rails and the play head, `diagonal` the cut — either a
 * flat colour or a `url(#id)` gradient reference.
 */
export function zMarkSvg(bars: string, diagonal: string): string {
  return [
    `<rect x="${SPINE_X}" y="${TOP_Y - halfRail}" width="${TOP_END - SPINE_X}" height="${RAIL}" rx="${RAIL_RADIUS}" fill="${bars}"/>`,
    `<path d="${PLAY_HEAD_D}" fill="${bars}" stroke="${bars}" stroke-width="${PLAY_HEAD_STROKE}" stroke-linejoin="round"/>`,
    `<path d="${DIAGONAL_D}" stroke="${diagonal}" stroke-width="${RAIL}" stroke-linecap="round" fill="none"/>`,
    `<rect x="${SPINE_X}" y="${BOTTOM_Y - halfRail}" width="${BOTTOM_END - SPINE_X}" height="${RAIL}" rx="${RAIL_RADIUS}" fill="${bars}"/>`,
  ].join('\n    ');
}
