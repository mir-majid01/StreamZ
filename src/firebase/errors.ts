import type { ActivateCode } from '@/src/firebase/models';
import { keyOutcomeMessage, type KeyState } from '@/src/firebase/subscriptions/keyOutcome';

/**
 * Activation copy lives in `keyOutcome.ts`, not in a table here. A second table is how one
 * sentence ("isn't valid") ended up covering a timeout, a rules refusal and a key that was
 * merely unrecognised, and it is how the app would drift out of step with whatever the backend
 * can actually distinguish. These functions are thin routes into that one mapping.
 *
 * `expiresAt` is optional so a caller that only has a code still gets the plain sentence, while
 * a caller that also read the key's expiry gets "expired 3 days ago" out of the same function.
 * Screens do not assemble these sentences themselves.
 */
export const describeActivation = (code: ActivateCode, expiresAt?: number | null): string =>
  keyOutcomeMessage({
    state: code as KeyState,
    // The activation transaction only ever reads the key document, so an EXPIRED code is
    // always the key's own expiry — never the account's.
    expiryOwner: code === 'EXPIRED' ? 'key' : 'unknown',
    expiresAt: expiresAt ?? null,
  });

const AUTH_COPY: Record<string, string> = {
  cancel: 'Sign-in was cancelled.',
  'network-request-failed': 'We could not reach the sign-in service. Check your connection.',
  'user-not-found': 'That account no longer exists.',
  'invalid-credential': 'Sign-in failed. Please try again.',
  'operation-not-allowed': 'Sign-in is not enabled for this build. Contact support.',
  'too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'popup-closed-by-user': 'Sign-in window was closed before it finished.',
};

// Transient conditions only. `cancelled` is deliberately excluded: a cancelled Google
// prompt is a user action, not a network failure, and must never trigger offline grace.
const TRANSPORT_CODES = new Set([
  'unavailable',
  'internal',
  'network-request-failed',
  'deadline-exceeded',
  'resource-exhausted',
  'unknown',
]);

export function describeAuthError(code: string): string {
  return AUTH_COPY[code] ?? 'Sign-in failed. Please try again.';
}

/**
 * A Firestore error code, read the same way as every other key outcome. `permission-denied` is
 * the rules refusing to answer — a fact about this device's reach, not about the key — so it is
 * reported as a check that could not be completed instead of as "not found" or "invalid".
 * Anything else in this bucket says the same thing with the network's reason.
 */
export function describeFirestoreError(code: string): string {
  return keyOutcomeMessage({
    state: code === 'permission-denied' ? 'CHECK_REFUSED' : 'CHECK_UNREACHABLE',
  });
}

/**
 * Only genuine transport failures may trigger offline grace. A refused permission must
 * never be grace-cached, or a revoked user keeps access on a bad network.
 */
export function isTransportError(e: unknown): boolean {
  const code =
    typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  return TRANSPORT_CODES.has(code.replace(/^functions\//, '').replace(/^firestore\//, ''));
}
