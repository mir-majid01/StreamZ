import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
import { mark } from '@/src/utils/startupTiming';

export const INSTALLATION_KEY = 'streamz.installationId';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A per-install identifier, not a hardware fingerprint. Android wipes secure storage on
 * uninstall, so this value legitimately changes after a reinstall — which is why the
 * server treats the Firebase UID as the primary binding (spec §12).
 *
 * SecureStore can reject outright (keystore reset, restore from backup) rather than
 * return null. A throw here would strand a paying subscriber on the gate, so both calls
 * are guarded and the value is regenerated rather than propagated as an error.
 */
export async function getInstallationId(): Promise<string> {
  let stored: string | null = null;
  try {
    stored = await SecureStore.getItemAsync(INSTALLATION_KEY);
  } catch {
    stored = null;
  }
  if (stored && UUID_RE.test(stored)) {
    mark('installation-id:restored');
    return stored;
  }

  const next = randomUUID().toLowerCase();
  try {
    await SecureStore.setItemAsync(INSTALLATION_KEY, next);
  } catch {
    // Non-fatal: the server still has the previous binding for this uid and will rotate it.
  }
  mark('installation-id:created');
  return next;
}
