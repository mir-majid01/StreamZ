import { AppState } from 'react-native';
import { doc, getFirestore, updateDoc } from '@react-native-firebase/firestore';
import { logEvent, getAnalytics } from '@react-native-firebase/analytics';
import { currentUserUid } from '@/src/firebase/init';

/**
 * App-level telemetry: a presence heartbeat in Firestore and a handful of Firebase
 * Analytics events.
 *
 * Nothing here may carry personal data. No key material, no email, no title names beyond
 * what the subscriber chose to watch, no free-text device identifiers — the payload is
 * counts and enums. Google Analytics is disclosed in the privacy draft (spec §17), and the
 * advertising identifier stays denied in `init.ts`.
 */

// A heartbeat every five minutes is enough to answer "who is on right now" and keeps the
// write cost negligible at any plausible user count.
const PRESENCE_INTERVAL_MS = 5 * 60_000;

let lastPingAt = 0;

/**
 * Writes `users/{uid}.lastActiveAt` and nothing else. That narrow field list is deliberate:
 * the rules permit exactly this one key to change, so a compromised telemetry path cannot
 * also flip a subscription status.
 */
export const pingPresence = async (force = false): Promise<void> => {
  const uid = currentUserUid();
  if (!uid) return;
  const now = Date.now();
  if (!force && now - lastPingAt < PRESENCE_INTERVAL_MS) return;
  lastPingAt = now;
  try {
    await updateDoc(doc(getFirestore(), 'users', uid), { lastActiveAt: now });
  } catch {
    // Presence is advisory. A refusal or an offline device is not an error a user can act on.
  }
};

/** Starts the heartbeat on mount and on every return to the foreground. */
export const startPresenceHeartbeat = (): (() => void) => {
  void pingPresence();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void pingPresence();
  });
  return () => sub.remove();
};

type EventParams = Record<string, string | number | boolean | null>;

/**
 * GA4 already measures app_open, sessions and engagement automatically, and watch activity
 * lives in Firestore as sessions. These are the two subscription moments worth adding —
 * names fixed here so the console's debug view sees one vocabulary rather than a
 * per-call-site dialect.
 */
export const AppEvent = {
  SIGN_IN: 'sign_in',
  KEY_ACTIVATION: 'key_activation',
} as const;

export const logAppEvent = (name: string, params: EventParams = {}): void => {
  try {
    void logEvent(getAnalytics(), name, params);
  } catch {
    // Analytics must never block or crash a user flow.
  }
};
