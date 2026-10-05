import { getApp, getApps } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import { getAnalytics, setConsent, setUserId } from '@react-native-firebase/analytics';

/**
 * React Native Firebase v26 is modular-only — there is no default export and no
 * `firebase.app()` namespace. Everything here goes through the named modular getters.
 */

export function ensureFirebase(): boolean {
  return getApps().length > 0;
}

export const firebaseProjectId = (): string | null =>
  ensureFirebase() ? getApp().options.projectId ?? null : null;

export const currentUserUid = (): string | null =>
  ensureFirebase() ? getAuth().currentUser?.uid ?? null : null;

/**
 * Spec amendment A4: no advertising identifier. v26 exposes consent rather than the old
 * `setAdvertisingIdCollectionEnabled`, so advertising storage is denied outright.
 */
export async function disableAdvertisingId(): Promise<void> {
  try {
    await setConsent(getAnalytics(), { advertising: 'denied', analyticsStorage: 'granted' });
  } catch {
    // Analytics is unavailable in some dev builds; telemetry must never block sign-in.
  }
}

export async function setAnalyticsUser(uid: string | null): Promise<void> {
  try {
    // GA4 measures app open and sessions automatically, so the only value worth adding is
    // the link between events and the signed-in uid (spec §15).
    await setUserId(getAnalytics(), uid ?? '');
  } catch {
    // Best effort.
  }
}
