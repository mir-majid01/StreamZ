import type { ActivateCode } from '@/src/firebase/models';

const ACTIVATION_COPY: Record<ActivateCode, string> = {
  ACTIVATED: 'Subscription activated.',
  ALREADY_OWNED: 'This subscription is already active on your device.',
  NOT_FOUND: "This subscription key isn't valid.",
  EXPIRED: 'This subscription key has expired.',
  REVOKED: 'This subscription has been revoked.',
  ALREADY_BOUND: 'This key is already linked to another account.',
  CEILING: 'This subscription has reached its device-change limit. Contact support.',
  UNAUTHENTICATED: 'Sign in before activating a key.',
};

const AUTH_COPY: Record<string, string> = {
  cancel: 'Sign-in was cancelled.',
  'network-request-failed': 'We could not reach the sign-in service. Check your connection.',
  'user-not-found': 'That account no longer exists.',
  'invalid-credential': 'Sign-in failed. Please try again.',
  'operation-not-allowed': 'Sign-in is not enabled for this build. Contact support.',
  'too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'popup-closed-by-user': 'Sign-in window was closed before it finished.',
};

const TRANSPORT_CODES = new Set(['unavailable', 'internal', 'network-request-failed']);

export const describeActivation = (code: ActivateCode): string => ACTIVATION_COPY[code];

export function describeAuthError(code: string): string {
  return AUTH_COPY[code] ?? 'Sign-in failed. Please try again.';
}

const GENERIC_NETWORK =
  "We couldn't verify your subscription. Check your connection and try again.";

export function describeFirestoreError(code: string): string {
  if (TRANSPORT_CODES.has(code)) return GENERIC_NETWORK;
  if (code === 'permission-denied') return 'You are not allowed to do that. Contact support.';
  return GENERIC_NETWORK;
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
