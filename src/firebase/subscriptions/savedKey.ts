import * as SecureStore from 'expo-secure-store';
import { canonicalPlaintext } from '@/src/firebase/subscriptions/keyFormat';

/**
 * The plain-text activation key is normally kept only as its SHA-256 (the
 * Firestore doc id), so it is unrecoverable after activation. For the Settings
 * "account" panel we opt in to caching the exact key the user typed, in the
 * device keystore-backed SecureStore (same primitive as the installation id) —
 * never AsyncStorage, never the JS bundle. It is scoped to the signed-in uid so
 * a second account on the same device can't read the first one's key.
 *
 * This is a deliberate trade-off the owner asked for: it stores a secret on the
 * device that the auth model otherwise never keeps. Android wipes it on
 * uninstall; a reveal is gated behind an explicit tap.
 */
const KEY_PREFIX = 'streamz.activationKey';
const keyForUser = (uid: string) => `${KEY_PREFIX}.${uid}`;

export async function saveActivationKey(
  uid: string,
  rawKey: string,
): Promise<void> {
  const canonical = canonicalPlaintext(rawKey);
  if (!canonical) return;
  try {
    await SecureStore.setItemAsync(keyForUser(uid), canonical);
  } catch {
    // Non-fatal: the account still works; the key simply won't be re-displayable.
  }
}

export async function loadActivationKey(uid: string): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(keyForUser(uid));
    return stored && canonicalPlaintext(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function clearActivationKey(uid: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(keyForUser(uid));
  } catch {
    // Nothing to do if the keystore rejects.
  }
}

/** Shows the first group and masks the rest: `ABCDE-•••••-•••••-•••••`. */
export function maskKey(canonical: string): string {
  const groups = canonical.split('-');
  return groups
    .map((g, i) => (i === 0 ? g : '•'.repeat(g.length)))
    .join('-');
}
