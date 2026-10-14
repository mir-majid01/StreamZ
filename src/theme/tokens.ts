/**
 * StreamZ design tokens (PRD §9-§12, §39) — the single source of every colour,
 * size, spacing step, radius, gradient and motion curve in the app.
 *
 * Layering:
 *   - global.css carries the same palette as semantic CSS variables, so Tailwind
 *     classes (bg-background, text-muted-foreground, …) resolve to these values.
 *     This file exists for the places Tailwind cannot reach: reanimated values,
 *     expo-linear-gradient stops, canvas-free SVG logos, navigation theme objects.
 *   - When a raw value is needed in TS, import it from here instead of inlining
 *     hex literals — that is what keeps ~25 legacy files from drifting apart.
 *
 * Colors are kept in sync with global.css by review; a mismatch between the two
 * is a bug in this file, not a styling choice.
 */

// ── Background ladder (dark foundation, darkest → lightest) ────────────────
export const BACKGROUND = {
  /** App base. Also the native window + splash background in app.json. */
  base: '#050505',
  /** Raised screens/bars sitting on base. */
  raised: '#080808',
  /** Highest background tier (modals over screens). */
  overlay: '#0D0D0F',
} as const;

// ── Surface ladder (cards, sheets, inputs on top of backgrounds) ───────────
export const SURFACE = {
  low: '#111114',
  mid: '#161619',
  high: '#1C1C21',
} as const;

// ── Brand ──────────────────────────────────────────────────────────────────
export const BRAND_COLOR = {
  primary: '#E50914',
  bright: '#FF3045',
  dark: '#B20710',
} as const;

/**
 * The logo-system ramp: the Z's diagonal and the auth screens read as one brand
 * because both stop here. Deliberately separate from BRAND_COLOR, which the rest
 * of the app still uses — migrating 47 hard-coded references is its own change.
 */
export const MARK_RAMP = {
  bright: '#FF3B52',
  deep: '#C20015',
} as const;

/**
 * Sign-in / activation palette. These screens are the only surfaces designed
 * against it, so the values live here rather than in global.css, where they
 * would imply a theme the rest of the app does not follow.
 */
export const AUTH = {
  ink: '#070506',
  /** Card face, top → bottom. */
  surfaceTop: '#131316',
  surfaceBottom: '#0E0E11',
  field: '#0A0A0C',
  chip: '#111114',
  hairline: '#232329',
  edge: '#26262C',
  rail: '#2A2A31',
  track: '#1F1F25',
  rowDivider: '#1D1D22',
  text: '#FFFFFF',
  muted: '#A1A1AA',
  faint: '#8B8B94',
  dim: '#9A9AA3',
  ctaTop: '#FF2D46',
  ctaBottom: '#B0000F',
  success: '#2EDC8C',
  /** A refusal is loud but not alarming: brighter than the CTA, never BRAND_COLOR. */
  alert: '#FF5468',
  alertText: '#FF6B7D',
  /** The button's travelling highlight. */
  sheen: 'rgba(255,255,255,0.22)',
  haloRed: 'rgba(255,45,70,0.26)',
  haloGreen: 'rgba(46,220,140,0.22)',
  badgeGreenBg: 'rgba(46,220,140,0.10)',
  badgeGreenEdge: 'rgba(46,220,140,0.25)',
} as const;

/**
 * Settings screen palette (design/settings/Settings.dc.html). Only the values the
 * mockup does not already share with AUTH/SURFACE are listed here — the screen
 * imports the shared ones, so a single edit keeps both surfaces in step.
 */
export const SETTINGS = {
  /** Account card face, top → bottom. One stop lighter than AUTH's panel. */
  accountTop: '#151518',
  accountBottom: '#0F0F12',
  groupEdge: '#1F1F25',
  rowDivider: '#1C1C21',
  iconTile: '#1A1A1F',
  iconStroke: '#E4E4E9',
  chevron: '#6B6B74',
  /** Pointer hover, and the D-pad focus fill. */
  hover: '#18181C',
  pressed: '#1E1E23',
  /** The account card warms rather than brightens when hovered. */
  accountEdgeHover: '#3A2327',
  /** One red bloom off-canvas at the top-right, same hue as the CTA ramp. */
  glow: 'rgba(255,45,70,0.16)',
} as const;

/** §9: the accent gradient is reserved — CTA, active nav, highlights, logo. */
export const GRADIENT = {
  accent: [BRAND_COLOR.bright, BRAND_COLOR.primary, BRAND_COLOR.dark] as const,
  /** Vertical scrim that melts content into the background (hero → base). */
  scrim: ['transparent', 'rgba(5,5,5,0.82)', BACKGROUND.base] as const,
} as const;

// ── Text tiers (on dark) ───────────────────────────────────────────────────
export const TEXT_COLOR = {
  primary: '#FFFFFF',
  secondary: '#B3B3B8',
  tertiary: '#7A7A82',
  disabled: '#4A4A52',
} as const;

export const BORDER_COLOR = {
  subtle: '#1F1F24',
  strong: '#2A2A31',
} as const;

// ── Spacing scale (§12) — 4-base steps; arbitrary values need a reason ─────
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  massive: 48,
  gigantic: 64,
} as const;

// ── Typography (§11) ───────────────────────────────────────────────────────
// Font files are embedded through expo-font (useFonts in App.tsx); the keys
// below are the exact `fontFamily` strings the loader registers.
export const FONT = {
  display: 'SpaceGrotesk-700',
  displayMedium: 'SpaceGrotesk-600',
  displayNormal: 'SpaceGrotesk-500',
  displayRegular: 'SpaceGrotesk-400',
  body: 'Inter-400',
  bodyMedium: 'Inter-500',
  bodySemiBold: 'Inter-600',
  bodyBold: 'Inter-700',
  bodyExtraBold: 'Inter-800',
  /** The auth flow's body face. The rest of the app stays on Inter for now. */
  sans: 'DMSans-400',
  sansMedium: 'DMSans-500',
  sansSemiBold: 'DMSans-600',
  /** A key is read character by character, so it is set monospaced. */
  mono: 'JetBrainsMono-500',
  monoSemiBold: 'JetBrainsMono-600',
} as const;

export const TYPE_SIZE = {
  hero: 32,
  screenTitle: 26,
  sectionTitle: 20,
  cardTitle: 15,
  body: 15,
  secondary: 13,
  caption: 12,
  metadata: 11,
  nav: 11,
  button: 15,
} as const;

// ── Radius / elevation ─────────────────────────────────────────────────────
export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const OPACITY = {
  disabled: 0.4,
  pressed: 0.72,
  scrim: 0.6,
} as const;

// ── Iconography ────────────────────────────────────────────────────────────
export const ICON_SIZE = {
  nav: 24,
  row: 20,
  inline: 16,
  hero: 28,
} as const;

// ── Motion language (§29-§30) ──────────────────────────────────────────────
export const MOTION = {
  /** Micro feedback: press scale, icon ticks. */
  fast: { duration: 120 },
  /** State changes: fade in/out, chip selection. */
  base: { duration: 200 },
  /** Entrances: slide-up, skeleton first paint. */
  slow: { duration: 320 },
  /** Cinematic: splash sequence steps. */
  cinematic: { duration: 600 },
  /** §30: ambient background drift — deliberately near-imperceptible. */
  ambient: { duration: 12000 },
  pressScale: 0.97,
  /** Reanimated spring config for release snap-back. */
  spring: { damping: 18, stiffness: 220, mass: 0.7 },
} as const;

// ── Semantic aliases the components use ────────────────────────────────────
export const THEME = {
  background: BACKGROUND.base,
  surface: SURFACE.low,
  surfaceRaised: SURFACE.mid,
  surfaceHigh: SURFACE.high,
  primary: BRAND_COLOR.primary,
  onPrimary: '#FFFFFF',
  textPrimary: TEXT_COLOR.primary,
  textSecondary: TEXT_COLOR.secondary,
  textTertiary: TEXT_COLOR.tertiary,
  border: BORDER_COLOR.subtle,
  danger: BRAND_COLOR.primary,
  success: '#2FBF71',
} as const;
