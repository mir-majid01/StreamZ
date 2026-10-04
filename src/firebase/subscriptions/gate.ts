import type { AccessResult, GateDecision } from '@/src/firebase/models';

export interface GateFacts {
  uid: string | null;
  /** The uid the verdict was issued for. A verdict for another account is never honoured. */
  liveUid: string | null;
  live: AccessResult | null;
  transportFailed: boolean;
  lastGoodAuthorizedAt: number | null;
  nowMs: number;
  graceMs: number;
}

/**
 * Ordering rules, in the order they are applied:
 *  1. A live negative verdict (needsKey / expired / revoked / suspended / disabled /
 *     ceiling) always wins, even while the transport is failing. Caching must never
 *     rescue a revocation.
 *  2. A live positive verdict is honoured only while the server is reachable. Once the
 *     transport is failing it stops being authoritative and the bounded grace window
 *     takes over, so an `authorized` verdict cannot grant access for the whole term.
 *  3. Grace applies only from a recorded prior authorization, inside the window, and
 *     only for a non-negative age (a future-dated cache entry is not trusted).
 */
export function decideGate(f: GateFacts): GateDecision {
  if (!f.uid) return 'signedOut';

  const live = f.live && f.liveUid === f.uid ? f.live : null;
  if (f.live && !live) return 'bootstrapping';

  if (live && live.status !== 'authorized' && live.status !== 'needsKey') return 'blocked';
  if (live && live.status === 'needsKey') return 'needsSubscription';

  if (live && live.status === 'authorized') {
    if (live.expiresAt === null) return 'blocked';
    if (live.serverTimeMs >= live.expiresAt) return 'blocked';
    if (f.transportFailed) return grace(f);
    return 'ready';
  }

  if (f.transportFailed) return grace(f);
  return 'bootstrapping';
}

function grace(f: GateFacts): GateDecision {
  if (f.lastGoodAuthorizedAt === null) return 'needsServerContact';
  const age = f.nowMs - f.lastGoodAuthorizedAt;
  if (age < 0) return 'needsServerContact';
  return age <= f.graceMs ? 'offlineCached' : 'needsServerContact';
}

const ROUTES: Record<GateDecision, 'Login' | 'Subscription' | 'Main' | 'Blocked'> = {
  signedOut: 'Login',
  needsSubscription: 'Subscription',
  ready: 'Main',
  offlineCached: 'Main',
  bootstrapping: 'Blocked',
  needsServerContact: 'Blocked',
  blocked: 'Blocked',
};

export const routeFor = (d: GateDecision): 'Login' | 'Subscription' | 'Main' | 'Blocked' =>
  ROUTES[d];

export function shouldRevalidate(
  lastValidatedAtMs: number | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (lastValidatedAtMs === null) return true;
  return nowMs - lastValidatedAtMs >= intervalMs;
}
