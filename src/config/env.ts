/**
 * Centralized runtime configuration.
 * Values are read from `EXPO_PUBLIC_*` variables so secrets live in `.env`,
 * never hardcoded in source. See `.env.example` for the required keys.
 */

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    console.warn(`[env] Missing ${name}. Add it to your .env file.`);
    return '';
  }
  return value;
};

export const TMDB_CONFIG = {
  BASE_URL: required(process.env.EXPO_PUBLIC_TMDB_BASE_URL, 'EXPO_PUBLIC_TMDB_BASE_URL'),
  IMAGE_BASE_URL: required(
    process.env.EXPO_PUBLIC_TMDB_IMAGE_BASE_URL,
    'EXPO_PUBLIC_TMDB_IMAGE_BASE_URL',
  ),
  API_KEY: required(process.env.EXPO_PUBLIC_TMDB_API_KEY, 'EXPO_PUBLIC_TMDB_API_KEY'),
} as const;

export const WYZIE_SUBS_CONFIG = {
  BASE_URL: required(process.env.EXPO_PUBLIC_WYZIE_BASE_URL, 'EXPO_PUBLIC_WYZIE_BASE_URL'),
  API_KEY: required(process.env.EXPO_PUBLIC_WYZIE_API_KEY, 'EXPO_PUBLIC_WYZIE_API_KEY'),
  TIMEOUT: 10000,
} as const;

// Public sample clip (not a secret). Falls back to the W3C-hosted Sintel
// trailer — a small, fast, HTTPS MP4 that loads reliably across platforms —
// if the env var isn't provided, so the player always has a valid source.
export const SAMPLE_VIDEO_URL =
  process.env.EXPO_PUBLIC_SAMPLE_VIDEO_URL ||
  'https://media.w3.org/2010/05/sintel/trailer.mp4';

// GitHub repository the in-app updater polls for the latest release. Override
// via `.env` if you fork the project into your own repo.
// Watch-party WebSocket, e.g. wss://flickv4.nibbleph.dev
export const WATCH_PARTY_CONFIG = {
  url: process.env.EXPO_PUBLIC_WATCH_PARTY_URL?.trim() || '',
  enabled: Boolean(process.env.EXPO_PUBLIC_WATCH_PARTY_URL?.trim()),
} as const;

/** FlixQuest scraper API (VOD providers + DLHD live TV). Empty = feature off. */
export const FLIXQUEST_CONFIG = {
  url: process.env.EXPO_PUBLIC_FLIXQUEST_API_URL?.trim() || '',
  enabled: Boolean(process.env.EXPO_PUBLIC_FLIXQUEST_API_URL?.trim()),
} as const;

/** Remote M3U playlist merged into Live TV as the PH category. */
const DEFAULT_LIVE_TV_M3U_URL =
  'https://raw.githubusercontent.com/Harleythetech/IPHTV/main/ph.m3u';

export const LIVE_TV_M3U_CONFIG = {
  url: process.env.EXPO_PUBLIC_LIVE_TV_M3U_URL?.trim() || DEFAULT_LIVE_TV_M3U_URL,
  enabled: true,
} as const;

/** Live tab is shown when FlixQuest DLHD and/or the PH M3U playlist is on. */
export const LIVE_TV_CONFIG = {
  enabled: FLIXQUEST_CONFIG.enabled || LIVE_TV_M3U_CONFIG.enabled,
} as const;

/**
 * OAuth *web* client ID — the audience a Google ID token is minted for, which is
 * what lets Firebase Auth exchange it for a Firebase session. Firebase generates
 * one per project and exports it inside google-services.json as `client_type: 3`,
 * so the default below is the same public identifier already shipped in the APK.
 * Override with EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID when a different project is wired.
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ||
  '283831382421-edj7c7vbvl8m2ksmuan5o318d7lee7ql.apps.googleusercontent.com';

export const UPDATE_CONFIG = {
  OWNER: process.env.EXPO_PUBLIC_UPDATE_REPO_OWNER || 'sheeshcake',
  REPO: process.env.EXPO_PUBLIC_UPDATE_REPO_NAME || 'Flickv4',
  API_BASE_URL: 'https://api.github.com',
  /** Minimum hours between automatic update checks. */
  CHECK_INTERVAL_HOURS: 24,
  /** Delay in ms after mount before the first check, so app boot is snappy. */
  INITIAL_CHECK_DELAY_MS: 2000,
} as const;
