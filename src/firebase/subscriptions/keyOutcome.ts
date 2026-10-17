import {
  DAY_MS,
  type AccessResult,
  type AccessStatus,
  type ActivateCode,
  type ActivateResult,
  type GateDecision,
} from '@/src/firebase/models';
import { timeAgoLabel } from '@/src/utils/subscriptionTerms';

/**
 * The one place that turns an *observed* subscription fact into user-facing English.
 *
 * Why this file exists: the codes `activate()` and `validate()` already distinguish far more
 * than the screens used to say. `NOT_FOUND` was rendered as "isn't valid", a rules refusal was
 * rendered as "You are not allowed to do that", and a timeout, a revoked key and a suspended
 * account all collapsed into one "Access Revoked" panel. A key outcome is a fact about the
 * user's money and access, so each observed state gets its own sentence, and nothing gets a
 * sentence the backend did not state.
 *
 * WHAT THE BACKEND CAN ACTUALLY DISTINGUISH
 * -----------------------------------------
 * Firestore rules are the whole backend (Spark plan, no Functions), and they only ever answer
 * "may this caller read this document" — so a state is reportable only when a permitted read
 * or a transaction verdict reveals it:
 *
 *   UNUSED, not bound to anyone  -> `activate()` reaches the write branch: ACTIVATED.
 *   ACTIVE, bound to this uid    -> readable (rules line: `resource.data.uid == request.auth.uid`),
 *                                   and its `expiresAt` says whether it is still in date, so
 *                                   ALREADY_OWNED and EXPIRED are both real, distinct answers.
 *   EXPIRED / REVOKED status     -> settable by staff only (rules `status in ['UNUSED','ACTIVE',
 *                                   'EXPIRED','REVOKED']`), readable by the bound account, so
 *                                   EXPIRED and REVOKED are real answers for your own key.
 *   users/{uid}.status           -> 'suspended' | 'disabled' are real account states, set by
 *                                   staff; they say nothing about the key.
 *   the rotation counter         -> CEILING, computed against `config/app.maxInstallationRotations`.
 *   no document for that hash    -> `NOT_FOUND`, but only for a caller the rules let read a
 *                                   missing document (a malformed key never reaches Firestore at
 *                                   all, and staff-role callers are the only ones whose read of a
 *                                   missing document succeeds).
 *
 * NOT reportable, and therefore never claimed here:
 *   * "This key belongs to somebody else." A key that is ACTIVE under another uid is
 *     unreadable by design (`allow get: if isStaff() || (signedIn() && (status == 'UNUSED' ||
 *     uid == request.auth.uid))`), so the transaction's first read throws `permission-denied`
 *     before the ALREADY_BOUND branch can be reached. ALREADY_BOUND stays mapped — a staff-role
 *     caller, or a future rule that widens reads, can still produce it — but in production this
 *     state arrives as CHECK_REFUSED, and CHECK_REFUSED says exactly what was observed and not
 *     more. Telling the user "that key belongs to another account" from a refusal would be a
 *     guess, and it would be the first thing on the way to an existence oracle.
 *   * "This key was never minted." Same reason: a missing document and a hidden document both
 *     refuse the read. `NOT_FOUND` therefore means "not recognised", never "does not exist",
 *     and no message here ever says the key is invalid, bogus or fake.
 *   * `SUSPENDED` / `DISABLED` on a KEY. `KeyStatus` is `UNUSED | ACTIVE | EXPIRED | REVOKED`
 *     and the rules refuse any other value on a staff update, so there is no such state to
 *     report — suspended and disabled are *account* states (`UserStatus`), and the copy below
 *     says "account", never "key".
 *
 * ENUMERATION SAFETY
 * ------------------
 * Key documents are addressed by the SHA-256 of their plaintext and only ever expose `keyHash`,
 * so the only way to test a key is to try to read it. Making the two refusals distinguishable
 * (for example by allowing a signed-in read of a *missing* subscriptionKeys document, which
 * would turn "not found" into a successful empty read) would let any signed-in device walk the
 * keyspace and learn which hashes are minted. That is why the ambiguity is documented in the
 * copy instead of being resolved by a rule change: the message must be honest about what the
 * app observed, because widening the rules to observe more would leak the ledger.
 *
 * Nothing in this file ever accepts the plaintext key: every message is built from a state and
 * an authoritative timestamp, so a key cannot leak through copy by construction.
 */

/** Whose `expiresAt` an expired verdict was read from. See `ExpiryOwner` in models.ts. */
export type ExpiryOwner = 'key' | 'account' | 'both' | 'unknown';

/** Every state the app can observe about a key or the account that presented it. */
export type KeyState =
  /** Observed by the activation transaction. */
  | ActivateCode
  /** Observed while checking, but says nothing about the key itself. */
  | 'CHECK_UNREACHABLE'
  | 'CHECK_REFUSED'
  | 'CHECK_UNEXPECTED'
  | 'CHECK_PENDING'
  | 'VERDICT_UNUSABLE'
  /** Observed from the account's own live verdict. */
  | 'SUBSCRIPTION_ACTIVE'
  | 'NO_KEY_ON_ACCOUNT'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DISABLED';

export interface KeyOutcomeFacts {
  state: KeyState;
  /**
   * The authoritative `expiresAt` the client read for this very outcome — from the key
   * document or from `users/{uid}`, whichever `expiryOwner` names. Null or absent when the
   * document carried no usable timestamp, which is the difference between "expired 3 days
   * ago" and a plain "has expired".
   */
  expiresAt?: number | null;
  expiryOwner?: ExpiryOwner;
  /** The clock to measure "ago" against. The verdict's own server time when there is one. */
  nowMs?: number;
}

/**
 * An expiry older than this is treated as corrupt data, not as history. A key cannot be minted
 * with a decade-old expiry (the rules bound durationDays to 3650 and the client stamps
 * `activatedAt + durationMs` at write time), so a gap that large means the field is a stray
 * epoch zero, a unit error, or a document an admin edited by hand. Showing "expired 56 years
 * ago" would be a made-up duration wearing the costume of precision.
 */
const MAX_PLAUSIBLE_EXPIRED_AGE_MS = 10 * 365 * DAY_MS;

/**
 * Resolves `expiresAt` into "expired 3 days ago" only when the timestamp is a real one that
 * really is in the past. Returns null whenever only the plain sentence is honest.
 */
const expiredAgo = (facts: KeyOutcomeFacts): string | null => {
  const expiresAt = facts.expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  const nowMs = typeof facts.nowMs === 'number' && Number.isFinite(facts.nowMs) ? facts.nowMs : Date.now();
  const elapsed = nowMs - expiresAt;
  // Zero or negative means the timestamp has not passed (yet) on the clock we were given. That
  // is not an expiry, and "expired in the future" is never a sentence we print.
  if (elapsed <= 0 || elapsed > MAX_PLAUSIBLE_EXPIRED_AGE_MS) return null;
  return timeAgoLabel(elapsed);
};

interface OutcomeCopy {
  /** Long form: what a screen says after the user pressed a button. */
  detail: string;
  /** Short form: the same fact for a one-line status label. Same fact, same register everywhere. */
  status: string;
}

const EXPIRED_COPY = (facts: KeyOutcomeFacts): OutcomeCopy => {
  const ago = expiredAgo(facts);
  const owner = facts.expiryOwner ?? 'unknown';
  if (owner === 'key') {
    return ago
      ? { detail: `This key expired ${ago}.`, status: `Key expired ${ago}` }
      : { detail: 'This key has expired.', status: 'Key expired' };
  }
  if (owner === 'account') {
    // The two documents expire independently, and only one of them can be read as "the key
    // ran out". Say which one the app actually looked at.
    return ago
      ? {
          detail: `Your subscription on this account ended ${ago}, even though the key itself still had time left on it.`,
          status: `Account term ended ${ago}`,
        }
      : {
          detail: 'Your subscription on this account has ended, even though the key itself still had time left on it.',
          status: 'Account term ended',
        };
  }
  // 'both' is the rare honest case where the two documents state the same instant, so the
  // sentence says both. 'unknown' is reached when no document could be blamed, and must not
  // borrow the confidence of either of the attributed forms.
  if (owner === 'both') {
    return ago
      ? {
          detail: `This subscription expired ${ago} on both this key and this account.`,
          status: `Key and account expired ${ago}`,
        }
      : {
          detail: 'This subscription has expired on both this key and this account.',
          status: 'Key and account expired',
        };
  }
  return ago
    ? { detail: `This subscription expired ${ago}.`, status: `Expired ${ago}` }
    : { detail: 'This subscription has expired.', status: 'Expired' };
};

/**
 * One row per state, and the `Record<KeyState, …>` type is what makes adding a state without
 * adding its sentence a compile error. `EXPIRED` is the one row the table cannot hold: its
 * sentence depends on the expiry the client read and on whose document stated it, so it lives in
 * `EXPIRED_COPY` and is pinned here as `null` to keep the exhaustiveness check honest.
 */
const OUTCOMES: Record<Exclude<KeyState, 'EXPIRED'>, OutcomeCopy> & { EXPIRED: null } = {
  ACTIVATED: {
    detail: 'Key accepted — this subscription is now active on your account.',
    status: 'Subscription activated',
  },
  ALREADY_OWNED: {
    // Next action: nothing to do, carry on. Deliberately does not read like ALREADY_BOUND.
    detail: 'This key is already active on your account, so nothing needed changing. Carry on below to start watching.',
    status: 'Already active on this account',
  },
  NOT_FOUND: {
    // "not recognised", never "invalid": see the header note on the missing/hidden ambiguity.
    detail: "We couldn't match that to a key we're allowed to see. Check you entered it exactly as it was issued, then try again.",
    status: 'Key not recognised',
  },
  EXPIRED: null,
  REVOKED: {
    detail: 'The issuer revoked this key, so it no longer grants access. Contact support if you believe this is a mistake.',
    status: 'Key revoked by the issuer',
  },
  ALREADY_BOUND: {
    // Next action: this key is spent, get another. Only reachable for a caller the rules let
    // read somebody else's bound key; everybody else gets CHECK_REFUSED instead.
    detail: "This key has already been used by another account and can't be activated a second time. You'll need a different key, or contact support if that account is yours.",
    status: 'Key used by another account',
  },
  CEILING: {
    // A limit on *this account's* device changes, not a property of the key.
    detail: 'This account has used all of the device changes it allows. Contact support to have the limit reset.',
    status: 'Device-change limit reached',
  },
  UNAUTHENTICATED: {
    detail: 'Sign in with Google first, then enter your key.',
    status: 'Sign in first',
  },
  CHECK_UNREACHABLE: {
    // Must never read as a verdict about the key. Nothing was observed, so nothing was concluded.
    detail: "We couldn't reach the subscription service to check this key, so nothing was activated. Check your connection and try again.",
    status: "Couldn't reach the server",
  },
  CHECK_REFUSED: {
    detail: "The check couldn't be completed: the subscription service won't let this device read that key. That is true both for a key we can't recognise and for one already tied to another account, and nothing was activated. Re-check the key and try again, or contact support.",
    status: "Couldn't check this key",
  },
  CHECK_UNEXPECTED: {
    detail: 'Something went wrong while this key was being checked, so nothing was activated. Try again, or contact support if it keeps happening.',
    status: 'Check did not finish',
  },
  CHECK_PENDING: {
    detail: "Still checking this account with the subscription service. There's no verdict yet, so nothing has been decided about your key.",
    status: 'Checking subscription…',
  },
  VERDICT_UNUSABLE: {
    detail: 'The subscription service answered, but not with a verdict this app can use. Try again, or contact support.',
    status: 'Subscription status unavailable',
  },
  SUBSCRIPTION_ACTIVE: {
    detail: 'Your subscription is active on this account.',
    status: 'Subscription active',
  },
  NO_KEY_ON_ACCOUNT: {
    detail: 'No key has been activated on this account yet.',
    status: 'No key activated on this account',
  },
  ACCOUNT_SUSPENDED: {
    // `users/{uid}.status`, set by staff. There is no suspended state on a key document.
    detail: 'This account has been suspended by the service. The key itself is unchanged. Contact support.',
    status: 'Account suspended',
  },
  ACCOUNT_DISABLED: {
    detail: 'This account has been disabled by the service. Contact support.',
    status: 'Account disabled',
  },
};

/**
 * The unmapped case has to stay possible: `AccessStatus` and `ActivateCode` are unions other
 * builds can widen, and an unlisted value must be reported as "we could not tell" rather than
 * silently borrowing some other state's sentence — which is how an unknown error reads as
 * "revoked" to a paying user.
 */
const UNRECOGNISED: OutcomeCopy = {
  detail: 'Something unexpected happened while checking this key, so nothing was decided about it. Contact support.',
  status: 'Subscription status unclear',
};

const copyFor = (facts: KeyOutcomeFacts): OutcomeCopy => {
  if (facts.state === 'EXPIRED') return EXPIRED_COPY(facts);
  return OUTCOMES[facts.state as Exclude<KeyState, 'EXPIRED'>] ?? UNRECOGNISED;
};

/** Long form, for the panel the user is standing in front of after acting. */
export const keyOutcomeMessage = (facts: KeyOutcomeFacts): string => copyFor(facts).detail;

/** Short form of the same fact, for a one-line status label. Never a different fact. */
export const keyOutcomeStatus = (facts: KeyOutcomeFacts): string => copyFor(facts).status;

// ------------------------------------------------------------------ adapters
// Every screen goes through one of these, so no screen can invent its own reading of a code.

/**
 * `activate()` only ever reads the key document while it is deciding, so an EXPIRED refusal
 * from that transaction is always the key's own expiry.
 */
export const keyOutcomeOfActivateResult = (result: ActivateResult): KeyOutcomeFacts => ({
  state: result.code as KeyState,
  expiresAt: result.expiresAt,
  expiryOwner: result.code === 'EXPIRED' ? 'key' : 'unknown',
  nowMs: Date.now(),
});

const ACCESS_STATE: Record<AccessStatus, KeyState> = {
  authorized: 'SUBSCRIPTION_ACTIVE',
  needsKey: 'NO_KEY_ON_ACCOUNT',
  expired: 'EXPIRED',
  revoked: 'REVOKED',
  suspended: 'ACCOUNT_SUSPENDED',
  disabled: 'ACCOUNT_DISABLED',
  installationCeiling: 'CEILING',
  error: 'VERDICT_UNUSABLE',
};

/** The live verdict for this account. `null` is not a negative answer, it is no answer yet. */
export const keyOutcomeOfAccess = (access: AccessResult | null): KeyOutcomeFacts => {
  if (!access) return { state: 'CHECK_PENDING' };
  return {
    state: ACCESS_STATE[access.status] ?? 'VERDICT_UNUSABLE',
    expiresAt: access.expiresAt,
    expiryOwner: (access.expiryOwner as ExpiryOwner | undefined) ?? 'unknown',
    // The verdict's own clock, so "ago" is measured against the same instant the gate compared.
    nowMs: access.serverTimeMs,
  };
};

/**
 * The Blocked stack screens. `bootstrapping` and `needsServerContact` are not verdicts about
 * anybody's key, and collapsing them into "Access Revoked" invented a state the backend never
 * stated.
 */
export const keyOutcomeOfGate = (
  decision: GateDecision,
  access: AccessResult | null,
): KeyOutcomeFacts => {
  if (decision === 'needsServerContact') return { state: 'CHECK_UNREACHABLE' };
  // A verdict issued for a different account is discarded by the session layer, which leaves
  // `access` null: no answer, not a no.
  if (decision === 'bootstrapping') return keyOutcomeOfAccess(null);
  return keyOutcomeOfAccess(access);
};

/**
 * Classify a thrown value into a *kind* of failure, without deciding what it means about the
 * key. Pure, so the mapping is testable without the Firebase SDK: it reads only the code string
 * and message Firestore puts on the error.
 */
function errorText(e: unknown): string {
  const err = e as { code?: string | number; message?: string };
  const code = typeof err?.code === 'string' ? err.code : '';
  return `${code} ${err?.message ?? ''}`.toLowerCase();
}

const REFUSAL_PATTERN = /permission.denied|unauthenticated/;
const TRANSPORT_PATTERN =
  /unavailable|deadline.exceeded|network|resource.exhausted|internal|unimplemented|cancelled/;

/** A rules verdict: the service answered, and the answer was no. Retrying cannot change it. */
export const isRulesRefusalError = (e: unknown): boolean => REFUSAL_PATTERN.test(errorText(e));

/** The service could not be reached at all. Worth retrying; says nothing about any key. */
export const isTransportFailureText = (e: unknown): boolean =>
  !isRulesRefusalError(e) && TRANSPORT_PATTERN.test(errorText(e));

/**
 * A thrown value is never evidence that a key is wrong. A timeout, an offline device, a rules
 * refusal and an unknown crash all get their own sentence here, and none of them borrow the
 * wording of `NOT_FOUND`.
 */
export const keyOutcomeOfThrown = (e: unknown): KeyOutcomeFacts => {
  if (isTransportFailureText(e)) return { state: 'CHECK_UNREACHABLE' };
  if (isRulesRefusalError(e)) return { state: 'CHECK_REFUSED' };
  return { state: 'CHECK_UNEXPECTED' };
};
