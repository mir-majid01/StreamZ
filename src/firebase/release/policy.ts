import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  doc,
  getDoc,
  getFirestore,
} from '@react-native-firebase/firestore';
import { ensureFirebase } from '@/src/firebase/init';
import { BRAND } from '@/src/config/brand';
import { UPDATE_CONFIG } from '@/src/config/env';
import { getAppVersion, getInstalledAppVersion } from '@/src/utils/appVersion';
import { apkIntegrityAvailable, inspectApk } from '@/src/utils/apkIntegrity';
import {
  decideUpdate,
  evaluateApkIntegrity,
  isReleasePolicy,
  parseReleasePolicy,
  type IntegrityReason,
  type PolicyOutcome,
  type ReleasePolicy,
  type UpdateDecision,
} from '@/src/utils/releasePolicy';

/**
 * The release policy lives in its own one-document collection rather than in
 * `config/app`, because the app has to be able to read it **before** sign-in —
 * a device clock or a lost session must not hide a mandatory update — and
 * `config/app` holds values no unauthenticated caller should see. Rules grant
 * public read of `releasePolicy/latest` and nothing else, so this path is the
 * only unauthenticated read the app performs.
 */
const POLICY_CACHE_KEY = 'streamz.releasePolicy.v1';

/** What one read of the policy document produced, before any caching. */
export interface PolicyRead {
  outcome: PolicyOutcome;
  policy: ReleasePolicy | null;
}

/**
 * Turn a thrown Firestore error into an outcome. `permission-denied` is kept
 * distinct from "the document is not there": if the rules are wrong, an
 * updater that reported "no update published" would be lying, and the operator
 * would have no way to tell a bad rule from an empty collection.
 */
export const classifyPolicyError = (error: unknown): PolicyOutcome => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'permission-denied') return 'forbidden';
  if (code === 'unavailable' || code === 'deadline-exceeded') return 'unreachable';
  return 'unreachable';
};

/** Reject a hung Firestore call instead of letting it hold app startup open. */
const withTimeout = async <T,>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('policy-read-timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const readReleasePolicy = async (): Promise<PolicyRead> => {
  if (!ensureFirebase()) return { outcome: 'unreachable', policy: null };

  let snap;
  try {
    snap = await withTimeout(
      getDoc(
        doc(getFirestore(), UPDATE_CONFIG.POLICY_COLLECTION, UPDATE_CONFIG.POLICY_DOCUMENT),
      ),
      UPDATE_CONFIG.POLICY_TIMEOUT_MS,
    );
  } catch (error) {
    return { outcome: classifyPolicyError(error), policy: null };
  }

  if (!snap.exists()) return { outcome: 'missing', policy: null };

  const policy = parseReleasePolicy(snap.data() as Record<string, unknown>);
  // A document that exists but will not parse is reported, not swallowed: it
  // usually means the publisher wrote a half-finished record, and "no policy"
  // would send every device back to its cached guess.
  return policy
    ? { outcome: 'ok', policy }
    : { outcome: 'malformed', policy: null };
};

const saveCachedPolicy = async (
  policy: ReleasePolicy,
  fetchedAtMs: number,
): Promise<void> => {
  try {
    await AsyncStorage.setItem(
      POLICY_CACHE_KEY,
      JSON.stringify({ policy, fetchedAtMs }),
    );
  } catch {
    /* a device with a full store simply re-reads next launch */
  }
};

const loadCachedPolicy = async (): Promise<{
  policy: ReleasePolicy;
  fetchedAtMs: number;
} | null> => {
  try {
    const raw = await AsyncStorage.getItem(POLICY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { policy?: unknown; fetchedAtMs?: unknown };
    const at = parsed.fetchedAtMs;
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    // Validated against the parsed shape, because that is what was stored.
    return isReleasePolicy(parsed.policy) ? { policy: parsed.policy, fetchedAtMs: at } : null;
  } catch {
    return null;
  }
};

/**
 * Startup verdict: read the policy, cache it when it is good, and decide
 * whether this installed build is still allowed to run.
 *
 * Only a fresh policy, or a cached one inside the grace window and reached
 * through an `unreachable` failure, can produce `blocks`. Everything else is
 * `unknown`, which the UI must render as "not known" rather than as up to
 * date — a Firestore outage is not a green light, and it is not a lockout
 * either.
 */
export const evaluateReleasePolicy = async (): Promise<UpdateDecision> => {
  const [{ outcome, policy }, cached] = await Promise.all([
    readReleasePolicy(),
    loadCachedPolicy(),
  ]);

  if (outcome === 'ok' && policy) {
    const fetchedAtMs = Date.now();
    await saveCachedPolicy(policy, fetchedAtMs);
    return decideUpdate({
      installedVersion: getInstalledAppVersion() || getAppVersion(),
      outcome,
      policy,
      cached: { policy, fetchedAtMs },
      nowMs: fetchedAtMs,
      graceMs: UPDATE_CONFIG.OFFLINE_GRACE_MS,
    });
  }

  return decideUpdate({
    installedVersion: getInstalledAppVersion() || getAppVersion(),
    outcome,
    policy,
    cached,
    nowMs: Date.now(),
    graceMs: UPDATE_CONFIG.OFFLINE_GRACE_MS,
  });
};

/**
 * Measure a file we already downloaded and answer the only question that matters before
 * handing it to the installer: is this the APK the policy described?
 *
 * When the native verifier is absent the measurements are null, and `evaluateApkIntegrity`
 * turns that into a refusal. An unverifiable file is never installed, and never reported as
 * a pass.
 */
export const verifyDownloadedApk = async (
  fileUri: string,
  policy: ReleasePolicy | null,
): Promise<{ allowed: boolean; reason: IntegrityReason }> => {
  const actual = apkIntegrityAvailable() ? await inspectApk(fileUri) : null;
  return evaluateApkIntegrity({
    policy,
    actual,
    expectedPackageName: BRAND.applicationId,
  });
};
