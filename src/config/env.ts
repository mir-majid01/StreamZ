/**
 * Centralized runtime configuration.
 * Values are read from `EXPO_PUBLIC_*` variables so secrets live in `.env`,
 * never hardcoded in source. See `.env.example` for the required keys.
 */

import { FEATURES } from '@/src/config/features';

const required = (value: string | undefined, name: string): string => {
  if (!value) {
    console.warn(`[env] Missing ${name}. Add it to your .env file.`);
    return '';
  }
  return value;
};

export const TMDB_CONFIG = {
  // Not secrets and never change, so an unset value falls back to the documented default
  // instead of producing a base URL of '' — which makes `new URL()` throw before the first
  // request is even attempted. The CI workflow already supplies these same two defaults.
  BASE_URL: process.env.EXPO_PUBLIC_TMDB_BASE_URL?.trim() || 'https://api.themoviedb.org/3',
  IMAGE_BASE_URL:
    process.env.EXPO_PUBLIC_TMDB_IMAGE_BASE_URL?.trim() || 'https://image.tmdb.org/t/p/w500',
  // The key gets no fallback: it is a secret, and a build without one has to say so plainly
  // rather than let every request come back as a TMDB 401 that reads like a blocked network.
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
  // The flag wins over the environment: a build that hides a feature must hide it even when
  // a server URL is configured, or the settings row and player buttons stay visible.
  enabled: FEATURES.watchParty && Boolean(process.env.EXPO_PUBLIC_WATCH_PARTY_URL?.trim()),
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

/** Live tab is shown when the Phase 1A flag is on and a source is configured. */
export const LIVE_TV_CONFIG = {
  enabled: FEATURES.liveTv && (FLIXQUEST_CONFIG.enabled || LIVE_TV_M3U_CONFIG.enabled),
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

/**
 * Offline grace, in hours, before a cached mandatory-release policy stops
 * gating the app. Clamped because a typo here is the difference between "the
 * Firestore outage cost the user an afternoon" and "the app can never be
 * opened again without the publisher's server".
 */
const offlineGraceMs = (): number => {
  const raw = process.env.EXPO_PUBLIC_UPDATE_OFFLINE_GRACE_HOURS?.trim();
  const hours = raw === undefined || raw === '' ? 72 : Number(raw);
  if (!Number.isFinite(hours) || hours < 0) return 72 * 3_600_000;
  return Math.min(Math.floor(hours), 168) * 3_600_000;
};

/**
 * In-app updates. There is deliberately **no** built-in default repository:
 * a hardcoded owner/name is what made the upstream project's APK downloadable
 * from a StreamZ build. The updater is inert until the owner names their own
 * releases through the environment, and `FEATURES.updateChecker` must be
 * flipped separately — either one alone keeps it off.
 */
export const UPDATE_CONFIG = {
  OWNER: process.env.EXPO_PUBLIC_UPDATE_REPO_OWNER?.trim() ?? '',
  REPO: process.env.EXPO_PUBLIC_UPDATE_REPO_NAME?.trim() ?? '',
  API_BASE_URL: 'https://api.github.com',
  /**
   * GitHub Releases are only a source of release *notes and a download URL*.
   * Whether an update is mandatory, and what makes a downloaded APK
   * trustworthy, is decided by the Firestore release-policy document — because
   * a repository the app can read is not an authority over its own version
   * floor.
   */
  POLICY_COLLECTION: 'releasePolicy',
  POLICY_DOCUMENT: 'latest',
  /**
   * How long a cached policy may still gate the app after Firestore becomes
   * unreachable. Bounded on purpose: long enough that a flight or an outage
   * does not lock a paying user out, short enough that a pulled mandatory
   * release is obeyed again the next time the network is up. Only an
   * `unreachable` outcome may use the cache — a refusal, a missing document, or
   * a malformed one never does.
   */
  OFFLINE_GRACE_MS: offlineGraceMs(),
  /** Bounded wait for the policy read; a hung Firestore call must not hang boot. */
  POLICY_TIMEOUT_MS: 8000,
  /**
   * Off until the whole verification chain (policy published, checksum in CI,
   * native integrity check green on device) passes. `configured` is the second
   * gate: an enabled flag with no repository named is still no updater.
   */
  enabled: FEATURES.updateChecker,
  /** Minimum hours between automatic update checks. */
  CHECK_INTERVAL_HOURS: 24,
  /** Delay in ms after mount before the first check, so app boot is snappy. */
  INITIAL_CHECK_DELAY_MS: 2000,
} as const;

/** True only when the owner has actually named a repository of their own. */
export const updateRepoConfigured = (): boolean =>
  UPDATE_CONFIG.OWNER.length > 0 && UPDATE_CONFIG.REPO.length > 0;

/** Both conditions, so no call site has to remember that the flag alone is not enough. */
export const updatesActive = (): boolean =>
  UPDATE_CONFIG.enabled && updateRepoConfigured();
