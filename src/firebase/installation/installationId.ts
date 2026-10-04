import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

export const INSTALLATION_KEY = 'streamz.installationId';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A per-install identifier, not a hardware fingerprint. Android wipes secure storage on
 * uninstall, so this value legitimately changes after a reinstall — which is why the
 * server treats the Firebase UID as the primary binding (spec §12).
 */
export async function getInstallationId(): Promise<string> {
  const stored = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (stored && UUID_RE.test(stored)) return stored;
  const next = randomUUID().toLowerCase();
  await SecureStore.setItemAsync(INSTALLATION_KEY, next);
  return next;
}
