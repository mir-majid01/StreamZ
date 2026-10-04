import firebase from '@react-native-firebase/app';
import auth from '@react-native-firebase/auth';
import analytics from '@react-native-firebase/analytics';

let prepared = false;

/**
 * Native Firebase reads its project config from android/app/google-services.json, so
 * there is no key to ship here. Returns false when the native config is missing, which
 * the gate treats as a transport failure rather than an authorization result.
 */
export function ensureFirebase(): boolean {
  if (prepared) return true;
  if (!firebase.apps.length) return false;
  firebase.functions().useFunctionsRegion('us-central1');
  prepared = true;
  return true;
}

export const firebaseProjectId = (): string | null =>
  firebase.apps.length ? firebase.app().options.projectId : null;

export const currentUserUid = (): string | null => auth().currentUser?.uid ?? null;

/** Spec amendment A4: no advertising identifier is ever collected. */
export async function disableAdvertisingId(): Promise<void> {
  try {
    await analytics().setAdvertisingIdCollectionEnabled(false);
  } catch {
    // Analytics may be unavailable in a dev build; never block sign-in on it.
  }
}

export async function setAnalyticsUser(uid: string | null): Promise<void> {
  try {
    // GA4 measures app open and sessions automatically; the only thing worth adding here
    // is the association between events and the signed-in uid (spec §15).
    await analytics().setUserId(uid ?? '');
  } catch {
    // Telemetry is best-effort; a dropped call must never reach the user.
  }
}
