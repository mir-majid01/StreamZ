/**
 * Owner item P3: "transitions into the splash screen, login page and main app are not
 * consistently smooth and can show visual glitches", and the requirement that the app move on
 * only once the relevant initialisation state is actually known.
 *
 * The decisions are asserted against the pure modules that own them
 * (`src/utils/startupSequence.ts`, `src/firebase/subscriptions/gate.ts`), because Jest cannot
 * import anything under `src/screens/` — `react-native-css` throws at module load. What the
 * screens are responsible for is that they *ask those modules* rather than deciding again, and
 * that is pinned by reading the source, the way `home-header-layout.test.ts` does it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { decideGate, routeFor, type GateFacts } from '@/src/firebase/subscriptions/gate';
import type { AccessResult } from '@/src/firebase/models';
import {
  AUTH_HYDRATION_BUDGET_MS,
  IDENT_TOTAL_MS,
  bootMustWaitForReleaseCheck,
  didAuthHydrationTimeOut,
  handoffAnimation,
  identTimeline,
  splashMayEnter,
  splashStatusMessage,
  statusCopyIsUserFacing,
} from '@/src/utils/startupSequence';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;
const authorized: AccessResult = {
  status: 'authorized',
  expiresAt: NOW + DAY * 10,
  serverTimeMs: NOW,
};

/** A device that has finished authenticating but not yet received a subscription verdict. */
const hydrated = (over: Partial<GateFacts> = {}): GateFacts => ({
  uid: 'u1',
  authHydrated: true,
  authInitFailed: false,
  liveUid: 'u1',
  live: null,
  transportFailed: false,
  lastGoodAuthorizedAt: null,
  nowMs: NOW,
  graceMs: DAY,
  ...over,
});

/** The whole launch decision, exactly as the splash composes it. */
const enterFrom = (facts: GateFacts, drawn = true, booted = true) => ({
  decision: decideGate(facts),
  route: routeFor(decideGate(facts)),
  mayEnter: splashMayEnter({
    drawn,
    booted,
    gateKnown: decideGate(facts) !== 'bootstrapping',
  }),
});

describe('the launch handoff goes to the screen the session actually supports', () => {
  it('an unauthenticated device goes to Login', () => {
    const out = enterFrom(hydrated({ uid: null }));
    expect(out.decision).toBe('signedOut');
    expect(out.route).toBe('Login');
    expect(out.mayEnter).toBe(true);
  });

  it('an authenticated, subscribed device goes to Main', () => {
    const out = enterFrom(hydrated({ live: authorized }));
    expect(out.decision).toBe('ready');
    expect(out.route).toBe('Main');
    expect(out.mayEnter).toBe(true);
  });

  it('a signed-in device inside its offline grace also goes to Main', () => {
    const out = enterFrom(
      hydrated({ transportFailed: true, lastGoodAuthorizedAt: NOW - 60_000 }),
    );
    expect(out.decision).toBe('offlineCached');
    expect(out.route).toBe('Main');
  });

  it('a signed-in device with no key yet goes to Subscription, not to Login', () => {
    const out = enterFrom(hydrated({ live: { ...authorized, status: 'needsKey' } }));
    expect(out.route).toBe('Subscription');
  });
});

describe('nothing may leave Splash while the gate is still unknown', () => {
  // This is the clause the old splash enforced only by accident: it held for `bootstrapping`,
  // but the gate never reported `bootstrapping` for an un-hydrated device, so a slow auth
  // restore produced Login-then-Main instead of one handoff.
  it('holds on Splash while auth has not reported', () => {
    const out = enterFrom(hydrated({ uid: null, authHydrated: false }));
    expect(out.decision).toBe('bootstrapping');
    expect(out.mayEnter).toBe(false);
  });

  it('holds on Splash while a verdict for the session is pending', () => {
    const out = enterFrom(hydrated());
    expect(out.decision).toBe('bootstrapping');
    expect(out.mayEnter).toBe(false);
  });

  it('holds on Splash while the ident is still drawing, gate known or not', () =>
    expect(enterFrom(hydrated({ live: authorized }), false).mayEnter).toBe(false));

  it('holds on Splash while boot work is outstanding, gate known or not', () =>
    expect(enterFrom(hydrated({ live: authorized }), true, false).mayEnter).toBe(false));

  it('does not hold on the route a gate cannot name', () => {
    // `bootstrapping` maps to Blocked as a total function, but it must never be *navigated* to:
    // it means "unknown", and a Blocked screen for an unknown is a false accusation.
    expect(routeFor('bootstrapping')).toBe('Blocked');
    expect(splashMayEnter({ drawn: true, booted: true, gateKnown: false })).toBe(false);
  });
});

describe('an initialisation failure is a designed dead end, not a hang', () => {
  it('a device that cannot establish auth leaves Splash for a screen with a retry', () => {
    const out = enterFrom(hydrated({ uid: null, authHydrated: false, authInitFailed: true }));
    expect(out.decision).toBe('needsServerContact');
    expect(out.route).toBe('Blocked');
    expect(out.mayEnter).toBe(true);
  });

  it('the failure is only declared once the budget has actually run out', () => {
    expect(didAuthHydrationTimeOut(0, false)).toBe(false);
    expect(didAuthHydrationTimeOut(AUTH_HYDRATION_BUDGET_MS - 1, false)).toBe(false);
    expect(didAuthHydrationTimeOut(AUTH_HYDRATION_BUDGET_MS, false)).toBe(true);
  });

  it('a report that did arrive cancels the budget', () => {
    // The watchdog must never turn a healthy session into a dead end because it fired late.
    expect(didAuthHydrationTimeOut(AUTH_HYDRATION_BUDGET_MS * 10, true)).toBe(false);
  });

  it('the budget is a ceiling, not the normal path: far longer than a persisted restore', () =>
    // Firebase reads the session from disk, so the first callback needs no network. Anything
    // slower than this is a stuck native module, and the wait is not the mechanism either way.
    expect(AUTH_HYDRATION_BUDGET_MS).toBeGreaterThanOrEqual(10_000));
});

describe('the ident is a brand duration, and it is the same number everywhere', () => {
  it('reports the schedule the wordmark animates on', () => {
    const t = identTimeline(false);
    expect(t.animated).toBe(true);
    expect(t.settleMs).toBe(t.logoDelayMs + t.logoDurationMs);
    expect(t.totalMs).toBe(t.settleMs + t.ruleDurationMs);
    expect(t.totalMs).toBe(IDENT_TOTAL_MS);
  });

  it('has no fixed duration at all under reduce-motion', () => {
    const t = identTimeline(true);
    expect(t.animated).toBe(false);
    expect(t.totalMs).toBe(0);
    // Not "shorter" — absent. A user who asked for no motion must not wait on a brand film.
    for (const ms of [t.logoDelayMs, t.logoDurationMs, t.ruleDurationMs, t.settleMs]) {
      expect(ms).toBe(0);
    }
  });

  it('collapses the whole ident to zero rather than to a smaller number', () =>
    expect(identTimeline(true).totalMs).toBeLessThan(identTimeline(false).totalMs / 2));
});

describe('boot work the splash waits on is only work that can change the answer', () => {
  it('waits for the release check only when the updater is on', () => {
    expect(bootMustWaitForReleaseCheck(true)).toBe(true);
    // `FEATURES.updateChecker` is off, so this is the shipped path: the splash must not sit
    // behind an AsyncStorage read and write whose only possible result is "continue".
    expect(bootMustWaitForReleaseCheck(false)).toBe(false);
  });
});

describe('status copy describes the state the app is in', () => {
  it.each([
    ['bootstrapping', /checking access/i],
    ['needsServerContact', /connecting/i],
    ['signedOut', /preparing/i],
    ['ready', /preparing/i],
  ] as const)('%s reads as %p', (decision, pattern) =>
    expect(splashStatusMessage(decision)).toMatch(pattern));

  it('never names an SDK, a store, or an internal stage', () => {
    for (const decision of ['bootstrapping', 'signedOut', 'needsServerContact', 'ready'] as const) {
      expect(statusCopyIsUserFacing(splashStatusMessage(decision))).toBe(true);
    }
  });
});

describe('the handoff animates the same way in every direction', () => {
  it('crossfades, and stops animating entirely under reduce-motion', () => {
    expect(handoffAnimation(false)).toBe('fade');
    expect(handoffAnimation(true)).toBe('none');
  });
});

describe('the splash screen asks these modules instead of deciding again', () => {
  const splash = read('src/screens/SplashScreen.tsx');

  it('has no sleep standing in for readiness, and no pad on top of the ident', () => {
    expect(splash).not.toMatch(/TOTAL_MS\s*\+\s*80/);
    expect(splash).not.toMatch(/setTimeout\([^)]*setShowCopy/);
    expect(splash).toContain('splashMayEnter');
    expect(splash).toContain("'bootstrapping'");
  });

  it('takes its ident schedule from the shared timeline, not its own copy', () => {
    expect(splash).toContain('identTimeline');
    expect(splash).not.toMatch(/LOGO_SETTLE_MS|TOTAL_MS/);
  });

  it('does not touch storage on the boot path when the updater is off', () => {
    expect(splash).toContain('bootMustWaitForReleaseCheck(UPDATE_CONFIG.enabled)');
    // `saveLastUpdateCheck` survives only in the handlers that record a check that happened,
    // never as something the handoff waits behind.
    const bootRef = splash.slice(0, splash.indexOf('const handleCloseUpdater'));
    expect(bootRef).not.toContain('await saveLastUpdateCheck()');
  });

  it('respects the reduce-motion setting and drops the ambient drift with it', () => {
    expect(splash).toContain('usePrefersReducedMotion()');
    expect(splash).toMatch(/reduced \? null : \(/);
    expect(splash).toContain('<StreamZSplashWordmark');
  });

  it('still hands off with one replace, and still prefetches only after entry', () => {
    expect(splash).toContain('navigation.replace(target)');
    expect(splash).toContain("if (target === 'Main')");
    expect(splash).not.toMatch(/navigation\.navigate\(target\)/);
  });
});

describe('the wordmark reports its own finish instead of being timed', () => {
  const wordmark = read('src/components/splash/StreamZSplashWordmark.tsx');

  it('fires its completion from the animation callback', () => {
    expect(wordmark).toContain('runOnJS');
    expect(wordmark).toMatch(/if \(finished\) runOnJS\(reportSettled\)/);
    expect(wordmark).toMatch(/if \(finished\) runOnJS\(reportDrawEnd\)/);
  });

  it('keeps no timer of its own', () => {
    expect(wordmark).not.toContain('setTimeout');
    // The dead `GLOW_MS` phase and the duplicated schedule constants are gone: one timeline,
    // owned by `startupSequence.ts`.
    expect(wordmark).not.toContain('GLOW_MS');
    expect(wordmark).toContain('identTimeline');
  });

  it('places the ident at its finished state under reduce-motion', () => {
    expect(wordmark).toMatch(/if \(!timeline\.animated\) \{/);
    expect(wordmark).toContain('enter.value = 1');
  });
});
