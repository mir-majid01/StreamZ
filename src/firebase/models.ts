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

/**
 * Which document an expiry was read from. The key and the account expire independently — the
 * key document has its own `expiresAt`, `users/{uid}` has another, and `validate()` honours the
 * earlier of the two — so "expired" on its own does not say what actually ran out. Copy that
 * blames the key for an account-side expiry is a claim about somebody's money, so the source
 * travels with the verdict instead of being guessed at the screen.
 *
 * `both` is the honest answer when the two documents carry the same instant, and `unknown` the
 * honest answer when the verdict was reached without reading a timestamp at all (a staff-set
 * `status: 'EXPIRED'` on a key that never recorded one, for instance).
 */
export type ExpiryOwner = 'key' | 'account' | 'both' | 'unknown';

export interface AccessResult {
  status: AccessStatus;
  expiresAt: number | null;
  serverTimeMs: number;
  /** Present whenever `expiresAt` came from one of the two documents rather than being absent. */
  expiryOwner?: ExpiryOwner;
}

export interface ActivateResult {
  code: ActivateCode;
  /**
   * For `ACTIVATED` and `ALREADY_OWNED`, the expiry that is now in force. For an `EXPIRED`
   * refusal, the key document's own `expiresAt`, which is the fact the refusal was based on and
   * the only thing that lets the app say how long ago that was. Null when no expiry is stated by
   * either document, and null for the refusals that have nothing to do with time. Never a
   * client-supplied or invented value.
   */
  expiresAt: number | null;
  /**
   * The length of the term in days, so a client can show how much of it is left rather
   * than only when it ends. Read from the key document — the one place the admin actually
   * set it — and null for every refusal, where no term was granted. This is durationMs
   * rounded up to whole days, so use [durationMs] when the remainder matters.
   */
  durationDays: number | null;
  /**
   * The authoritative term length. Keys minted before sub-day durations existed derive it
   * from durationDays, so this is never null when a term was granted.
   */
  durationMs: number | null;
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
  /** The authoritative term. Absent on keys minted before sub-day durations existed. */
  durationMs?: number | null;
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
