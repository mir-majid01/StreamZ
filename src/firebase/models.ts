// Firestore document shapes shared by the client and Cloud Functions.
// All timestamps are epoch milliseconds (number), not Firestore Timestamp, so these
// types need no SDK import and both runtimes agree on one representation.

export type UserStatus = 'active' | 'suspended' | 'disabled';
export type KeyStatus = 'UNUSED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export type SessionState = 'open' | 'finalized';

export type AccessStatus =
  | 'authorized'
  | 'needsKey'
  | 'expired'
  | 'revoked'
  | 'suspended'
  | 'disabled'
  | 'installationCeiling';

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
}

export interface SubscriptionKeyDoc {
  keyId: string;
  keyHash: string;
  status: KeyStatus;
  durationDays: number;
  createdAt: number;
  createdBy: string;
  activatedAt: number | null;
  expiresAt: number | null;
  uid: string | null;
  installationId: string | null;
  lastValidatedAt: number | null;
}

export interface WatchSessionDoc {
  sessionId: string;
  uid: string;
  state: SessionState;
  contentId: string;
  contentTitle: string;
  contentType: 'movie' | 'episode' | 'clip' | 'other';
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

export interface DeviceDoc {
  uid: string;
  installationId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  rotations: number;
  revokedAt: number | null;
}

export interface AppConfigDoc {
  offlineGraceMinutes: number;
  keyDurationDays: number;
  maxInstallationRotations30d: number;
  staleSessionMinutes: number;
  minAppVersion: string;
}

export const CONFIG_DEFAULTS: AppConfigDoc = {
  offlineGraceMinutes: 1440,
  keyDurationDays: 30,
  maxInstallationRotations30d: 3,
  staleSessionMinutes: 10,
  minAppVersion: '0.0.0',
};
