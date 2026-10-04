import type { AccessResult, GateDecision } from '@/src/firebase/models';

export interface GateFacts {
  uid: string | null;
  live: AccessResult | null;
  transportFailed: boolean;
  lastGoodAuthorizedAt: number | null;
  nowMs: number;
  graceMs: number;
}

/**
 * Offline grace applies only when the last server verdict was `authorized`, so revoked,
 * suspended and expired can never be survived by caching, and a locally stored expiry
 * cannot extend anything.
 */
export function decideGate(f: GateFacts): GateDecision {
  if (!f.uid) return 'signedOut';

  if (f.live) {
    if (f.live.status === 'authorized') {
      const expired = f.live.expiresAt !== null && f.live.serverTimeMs >= f.live.expiresAt;
      return expired ? 'blocked' : 'ready';
    }
    return f.live.status === 'needsKey' ? 'needsSubscription' : 'blocked';
  }

  if (f.transportFailed) {
    const age = f.lastGoodAuthorizedAt === null ? null : f.nowMs - f.lastGoodAuthorizedAt;
    return age !== null && age <= f.graceMs ? 'offlineCached' : 'needsServerContact';
  }

  return 'bootstrapping';
}

export function routeFor(
  d: GateDecision,
): 'Login' | 'Subscription' | 'Main' | 'Blocked' {
  if (d === 'signedOut') return 'Login';
  if (d === 'needsSubscription') return 'Subscription';
  if (d === 'ready' || d === 'offlineCached') return 'Main';
  return 'Blocked';
}

export function shouldRevalidate(
  lastValidatedAtMs: number | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (lastValidatedAtMs === null) return true;
  return nowMs - lastValidatedAtMs >= intervalMs;
}
