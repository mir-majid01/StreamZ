// Firestore document shapes shared by the client and Cloud Functions.
// All timestamps are epoch milliseconds (number), not Firestore Timestamp, so these
// types need no SDK import and both runtimes agree on one representation.

export type UserStatus = 'active' | 'suspended' | 'disabled';
export type KeyStatus = 'UNUSED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type SessionState = 'open' | 'finalized';

/**
 * Stored lowercase; StreamZ Admin upper-cases before matching its ContentType enum, so
 * any value outside this trio is silently dropped from the admin's analytics lists.
 */
export type ContentType = 'movie' | 'series' | 'episode';

export type AccessStatus =
  | 'authorized'
  | 'needsKey'
  | 'expired'
  | 'revoked'
  | 'suspended'
  | 'disabled'
  | 'installationCeiling'
  /**
   * The callable answered, but not with a verdict we can act on (rejected claim, bad
   * response, server bug). Blocked, and never eligible for offline grace — fabricating a
   * plausible status here would let an unknown error read as "revoked" to the user.
   */
  | 'error';

export type ActivateCode =
  | 'ACTIVATED'
  | 'ALREADY_OWNED'
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ALREADY_BOUND'
  | 'CEILING'
  | 'UNAUTHENTICATED';

export type GateDecision =
  | 'bootstrapping'
  | 'signedOut'
  | 'needsSubscription'
  | 'ready'
  | 'offlineCached'
  | 'needsServerContact'
  | 'blocked';

export interface AccessResult {
  status: AccessStatus;
  expiresAt: number | null;
  serverTimeMs: number;
}

export interface ActivateResult {
  code: ActivateCode;
  expiresAt: number | null;
}

export interface UserDoc {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  status: UserStatus;
  subscriptionId: string | null;
  installationId: string | null;
  activatedAt: number | null;
  expiresAt: number | null;
  lastLoginAt: number;
  lastActiveAt: number;
  appVersion: string;
  createdAt: number;
  /**
   * Lifetime count of installation rebindings. Without Cloud Functions the ceiling has to
   * be enforced somewhere a client cannot lie, so it lives here as a monotonic counter the
   * rules refuse to let go backwards or exceed config/app.maxInstallationRotations.
   */
  installationRotations: number;
}

export interface SubscriptionKeyDoc {
  /** The SHA-256 of the canonical plaintext, which is also this document's id. */
  keyHash: string;
  status: KeyStatus;
  durationDays: number;
  createdAt: number;
  createdBy: string;
  batchId?: string | null;
  batchLabel?: string | null;
  activatedAt: number | null;
  expiresAt: number | null;
  uid: string | null;
  installationId: string | null;
  /** Written by the user app on each successful check; admin-owned fields stay untouched. */
  lastValidatedAt?: number | null;
}

export interface WatchSessionDoc {
  sessionId: string;
  uid: string;
  state: SessionState;
  contentId: string;
  contentTitle: string;
  contentType: ContentType;
  providerId?: string | null;
  tmdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  startedAt: number;
  endedAt: number | null;
  positionMs: number;
  durationMs: number;
  watchDurationMs: number;
  completionPercentage: number;
  completed: boolean;
  installationId: string;
  appVersion: string;
  updatedAt: number;
}

/**
 * `devices/{uid__installationId}` — field names are the admin app's, because that is the
 * client that renders them (device model, activation date, rotation marker).
 */
export interface DeviceDoc {
  uid: string;
  installationId: string;
  deviceModel: string;
  appVersion: string;
  activatedAt: number;
  /** Set when a newer installation replaced this one; null means current. */
  rotatedAt: number | null;
}

export interface AppConfigDoc {
  offlineGraceMinutes: number;
  keyDurationDays: number;
  maxInstallationRotations: number;
  staleSessionMinutes: number;
  minAppVersion: string;
}

export const CONFIG_DEFAULTS: AppConfigDoc = {
  offlineGraceMinutes: 1440,
  keyDurationDays: 30,
  maxInstallationRotations: 5,
  staleSessionMinutes: 10,
  minAppVersion: '0.0.0',
};

/**
 * Config is authored in minutes; the gate and the revalidation timer work in
 * milliseconds. Doing this conversion anywhere else is how a 1440-minute grace
 * silently becomes 1440 ms and every offline user is locked out.
 */
export const DAY_MS = 86_400_000;

export const graceMsFrom = (config: AppConfigDoc): number => config.offlineGraceMinutes * 60_000;
export const staleMsFrom = (config: AppConfigDoc): number => config.staleSessionMinutes * 60_000;

/** Identity of what the player was given, for watch analytics (Task 26). */
export interface ContentIdentity {
  contentId: string;
  contentTitle: string;
  contentType: ContentType;
}
