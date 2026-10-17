import type { GateDecision } from '@/src/firebase/models';

/**
 * The startup decisions the launch experience is made of, in one pure module.
 *
 * `src/screens/*` cannot be imported into Jest at all (`react-native-css` throws during
 * module load), so anything worth asserting about the boot sequence has to live somewhere
 * the test runner can actually reach. The screens then read these functions rather than
 * re-deciding for themselves, which is what keeps the tested rule and the shipped rule
 * the same rule.
 */

// ── The brand ident ────────────────────────────────────────────────────────
/**
 * The ident is a brand animation, so it does have a duration — that part is a design
 * decision, not a readiness signal pretending to be one. What changed is *who says it is
 * over*: the splash now learns the ident finished from the animation's own completion
 * callback (`StreamZSplashWordmark.onDrawEnd`), and these numbers are only the upper bound
 * it promises that callback will have arrived by.
 */
export const IDENT_LOGO_DELAY_MS = 380;
export const IDENT_LOGO_DURATION_MS = 620;
export const IDENT_RULE_DURATION_MS = 240;
/** When the lockup is in place and status copy may appear. */
export const IDENT_SETTLE_MS = IDENT_LOGO_DELAY_MS + IDENT_LOGO_DURATION_MS;
/** The whole ident, flourish included. */
export const IDENT_TOTAL_MS = IDENT_SETTLE_MS + IDENT_RULE_DURATION_MS;

export interface IdentTimeline {
  logoDelayMs: number;
  logoDurationMs: number;
  /** The instant the lockup is in place: the earliest the status copy may appear. */
  settleMs: number;
  ruleDurationMs: number;
  /** Ident finished, decorative rule included: the bound the watchdog waits on. */
  totalMs: number;
  /** The ident plays at all. False under reduce-motion. */
  animated: boolean;
}

/**
 * Reduce-motion collapses the timeline to zero rather than shortening it. That is the
 * difference between "respect the setting" and "animate a bit less": with `animated: false`
 * the wordmark is placed at its finished state and reports the draw as done immediately, so
 * a user who asked for no motion never waits on a brand animation to reach the app.
 */
export const identTimeline = (reduced: boolean): IdentTimeline =>
  reduced
    ? {
        logoDelayMs: 0,
        logoDurationMs: 0,
        settleMs: 0,
        ruleDurationMs: 0,
        totalMs: 0,
        animated: false,
      }
    : {
        logoDelayMs: IDENT_LOGO_DELAY_MS,
        logoDurationMs: IDENT_LOGO_DURATION_MS,
        settleMs: IDENT_SETTLE_MS,
        ruleDurationMs: IDENT_RULE_DURATION_MS,
        totalMs: IDENT_TOTAL_MS,
        animated: true,
      };

// ── When the splash is allowed to hand off ─────────────────────────────────
export interface SplashReadiness {
  /** The ident has drawn itself out, or reduce-motion put it there without drawing. */
  drawn: boolean;
  /** The boot work that must precede entry has settled (see `bootMustWaitForReleaseCheck`). */
  booted: boolean;
  /**
   * The session gate has reached a state it can name. `bootstrapping` is the gate saying
   * "I do not know yet", and handing off on that answer is what shows the wrong screen.
   */
  gateKnown: boolean;
}

/**
 * Every clause is a real signal, and none of them is a clock. Dropping `gateKnown` is the
 * defect this replaces: with it absent, the splash could — and did — leave for Login while
 * Firebase had not yet reported whether a session exists, then get reset into Main when the
 * verdict landed one or two hundred milliseconds later.
 */
export const splashMayEnter = (f: SplashReadiness): boolean =>
  f.drawn && f.booted && f.gateKnown;

/**
 * Whether the splash must hold for the release-policy read before entering.
 *
 * The check is a Firestore round-trip plus two AsyncStorage accesses, and its only possible
 * outcome while `FEATURES.updateChecker` is off is "no answer, continue". Making it hold the
 * boot door for that is a storage read standing in for readiness, so when the updater is off
 * the boot work is settled at mount and nothing else waits on it.
 */
export const bootMustWaitForReleaseCheck = (updaterEnabled: boolean): boolean =>
  updaterEnabled;

// ── Auth hydration budget ─────────────────────────────────────────────────
/**
 * `onAuthStateChanged`'s first callback reads persisted state; it does not need the network,
 * so a device that has not reported anything by now is not slow, it is stuck (an unconfigured
 * Firebase app, a native module that never initialised). The budget is what turns that into a
 * designed dead end instead of a splash screen that waits forever. It is deliberately much
 * longer than any plausible restore, and it is a ceiling on the wait, never the thing that
 * ends it in the normal case.
 */
export const AUTH_HYDRATION_BUDGET_MS = 12_000;

/** The watchdog only ever fires while the state is still unknown. */
export const didAuthHydrationTimeOut = (
  elapsedMs: number,
  hydrated: boolean,
  budgetMs: number = AUTH_HYDRATION_BUDGET_MS,
): boolean => !hydrated && elapsedMs >= budgetMs;

// ── Status copy ────────────────────────────────────────────────────────────
/**
 * Keyed to the REAL gate state (PRD §4): the splash may never promise something the session
 * layer has not decided, and technical stages (a module name, a collection, a fetch) are
 * never named. Kept here so the wording rule is testable without rendering the screen.
 */
export const splashStatusMessage = (decision: GateDecision): string => {
  switch (decision) {
    case 'bootstrapping':
      return 'Checking access…';
    case 'needsServerContact':
      return 'Connecting…';
    default:
      return 'Preparing StreamZ…';
  }
};

/** Nothing in the copy may leak an SDK, a database, or an internal stage name. */
const INTERNAL_TERMS = /firebase|firestore|functions|asyncstorage|securestore|google-services|token|uid|ipc|module/i;
export const statusCopyIsUserFacing = (message: string): boolean => !INTERNAL_TERMS.test(message);

// ── Handoff presentation ──────────────────────────────────────────────────
export type HandoffAnimation = 'fade' | 'none';

/**
 * The gate handoff is one short crossfade in every direction (PRD §29: consistent, short).
 * A slide would make `Splash -> Main` read differently from `Splash -> Login` for no reason
 * the user cares about, and under reduce-motion there is nothing to crossfade.
 */
export const handoffAnimation = (reduced: boolean): HandoffAnimation =>
  reduced ? 'none' : 'fade';
