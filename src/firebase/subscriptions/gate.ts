import type { AccessResult, GateDecision } from '@/src/firebase/models';

export interface GateFacts {
  uid: string | null;
  /**
   * Firebase has delivered its first `onAuthStateChanged` callback, so `uid === null` now
   * means "there is no session" rather than "nothing has told us yet". Without this the two
   * are indistinguishable and the very first frames of the app answer a signed-out device for
   * a returning one.
   */
  authHydrated: boolean;
  /**
   * Auth state cannot be established at all — Firebase was never configured, or it did not
   * report within the hydration budget. This is a known answer of "no answer", which is a
   * dead end the gate names, not a wait.
   */
  authInitFailed: boolean;
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
 *  0. Auth has to be known before anything else can be. An app that cannot say whether a
 *     session exists says so, and never guesses `signedOut` — a guess here is the one that
 *     shows Login for a moment before the real verdict replaces it.
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
  // A device that cannot reach auth has not reached a signed-out state; it has reached the
  // same dead end as a device that cannot reach the server, and `needsServerContact` is the
  // one decision that routes there. It outranks everything below because nothing else is
  // knowable without it.
  if (f.authInitFailed) return 'needsServerContact';
  if (!f.authHydrated) return 'bootstrapping';

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

/** The stack screens that *are* the gate, as opposed to screens that live behind it. */
const GATE_SCREEN = new Set<string>(['Login', 'Subscription', 'Blocked']);

/**
 * The gate route the stack must show, or null when the stack is already allowed to be
 * where it is.
 *
 * Comparing the session route against the *deepest* navigation route is not enough: tabs
 * and pushed screens (`Settings`, `MyList`, `Player`) live inside `Main` and are never
 * gate screens, so a gate that only ever fires while standing on a gate screen silently
 * misses a sign-out, a revocation, or an expired grace window that happens mid-browsing.
 * The rule instead is directional — from inside the app only a gate that says "you are
 * not in" may eject you, and from a gate screen the stack must match the gate exactly.
 *
 * `Splash` is exempt: it performs the first handoff itself, and racing it would flash a
 * gate screen at startup.
 */
export function gateResetFor(
  sessionRoute: 'Login' | 'Subscription' | 'Main' | 'Blocked',
  currentRoute: string | undefined,
): 'Login' | 'Subscription' | 'Main' | 'Blocked' | null {
  if (!currentRoute || currentRoute === 'Splash') return null;
  if (GATE_SCREEN.has(currentRoute)) return currentRoute === sessionRoute ? null : sessionRoute;
  return sessionRoute === 'Main' ? null : sessionRoute;
}

export function shouldRevalidate(
  lastValidatedAtMs: number | null,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (lastValidatedAtMs === null) return true;
  return nowMs - lastValidatedAtMs >= intervalMs;
}
