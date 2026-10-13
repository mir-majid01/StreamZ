import { Dimensions, ScaledSize } from 'react-native';

/**
 * Tablet detection. Uses Android's smallest-width rule: a device is "large"
 * when its SHORTER logical edge (dp) is >= 600dp (sw600dp). That is the same
 * threshold Google uses to decide a window can show tablet layouts, and unlike
 * a physical-pixel check it is density-independent and orientation-independent:
 * a phone stays a phone whether it is held portrait or rotated to landscape,
 * because its short edge is ~360-420dp either way.
 *
 * The previous version also treated any edge >= 1000 *physical* px as a tablet,
 * which mis-classified nearly every modern phone (a 1224px-wide panel clears it)
 * as a tablet — which in turn unlocked the player's orientation on exit and
 * widened the poster grid from 3 to 4 columns, corrupting the layout.
 */
const TABLET_SMALLEST_WIDTH_DP = 600;

export const isTablet = (
  width?: number,
  height?: number,
): boolean => {
  // Read live when called without an explicit size, so this never reports a
  // stale orientation captured at module load.
  if (width === undefined || height === undefined) {
    const w = Dimensions.get('window');
    width = w.width;
    height = w.height;
  }
  return Math.min(width, height) >= TABLET_SMALLEST_WIDTH_DP;
};

export type DeviceKind = 'phone' | 'tablet' | 'tv';

export const getDeviceKind = (
  size: Pick<ScaledSize, 'width' | 'height'>,
  tv: boolean,
): DeviceKind => {
  if (tv) return 'tv';
  return isTablet(size.width, size.height) ? 'tablet' : 'phone';
};

/** Number of poster columns to render in a grid for the given device. */
export const getGridColumns = (kind: DeviceKind): number => {
  switch (kind) {
    case 'tv':
      return 6;
    case 'tablet':
      return 4;
    default:
      return 3;
  }
};

/** Poster card width (px) for horizontal rows. */
export const getCardWidth = (kind: DeviceKind, screenWidth: number): number => {
  switch (kind) {
    case 'tv':
      return 200;
    case 'tablet':
      return screenWidth * 0.24;
    default:
      return screenWidth * 0.36;
  }
};

export const POSTER_ASPECT_RATIO = 1.5; // height / width for TMDB posters

/** Poster card width (px) for ranked Top 10 rows — slightly larger than standard. */
export const getTopTenCardWidth = (
  kind: DeviceKind,
  screenWidth: number,
): number => Math.round(getCardWidth(kind, screenWidth) * 1.15);

export const getHorizontalPadding = (kind: DeviceKind): number => {
  switch (kind) {
    case 'tv':
      return 48;
    case 'tablet':
      return 16;
    default:
      return 16;
  }
};
