import { compareVersionCodes, compareVersions, isNewerRelease } from '@/src/utils/versions';
// Type-only: `UpdateService` is a runtime module this one must not pull in.
import type { UpdateInfo } from '@/src/services/UpdateService';

/**
 * The release policy as published in Firestore `releasePolicy/latest`.
 * Everything here is information the app already needs in order to offer an
 * update, so the document holds no secrets and is the one document the rules
 * let an unsigned-in client read.
 */
export interface ReleasePolicy {
  /** Versions below this one must update before the app is usable. */
  minimumSupportedVersion: string;
  latestVersion: string;
  releaseNotes: string;
  publishedAt: string | null;
  /** Direct APK download URL. */
  downloadUrl: string;
  /** Lower-case hex SHA-256 of the APK at `downloadUrl`. */
  sha256: string;
  /** Exact byte count of the APK, or null when the publisher did not state one. */
  sizeBytes: number | null;
  /**
   * SHA-256 of the DER signing certificate the APK must be signed by. Required:
   * a policy that names no certificate leaves the installer verifying a digest
   * against a file anybody could have produced with any key, so the publish
   * step has to state the identity and the device has to match it.
   */
  signingCertSha256: string;
  /**
   * Android refuses to install a build whose `versionCode` is lower than the one
   * already on the device, and two releases can share a `versionName`. Both are
   * optional because a policy published before sub-name releases existed carries
   * neither — and so does one read back from a cache written by an older build —
   * which must keep working rather than become "unknown".
   */
  latestVersionCode?: number | null;
  minimumSupportedVersionCode?: number | null;
}

export type PolicyOutcome =
  /** The document was read and parsed. */
  | 'ok'
  /** Reachable, but the document does not exist — the owner has not published a policy. */
  | 'missing'
  /** Rules refused the read. Distinct from `missing`: a rule change is not an absent release. */
  | 'forbidden'
  /** No usable response (offline, timeout, server error). */
  | 'unreachable'
  /** Read succeeded but required fields were absent or malformed. */
  | 'malformed';

/**
 * What each outcome is, said in the user's language. A manual "check for updates" has to answer
 * the same five states the boot gate silently swallows, and the four non-`ok` ones must never be
 * rendered as "you are up to date" — not knowing the release state is a different fact from being
 * current, exactly as `unknown` is a different verdict from `upToDate`.
 */
export const POLICY_OUTCOME_LABEL: Record<PolicyOutcome, string> = {
  ok: 'The published release was read.',
  missing: 'No release has been published to check against yet.',
  forbidden: "The published release could not be read: this device isn't allowed to see it.",
  unreachable: 'The release service could not be reached. Check your connection and try again.',
  malformed: 'The published release metadata is not readable, so nothing could be decided.',
};

export const policyOutcomeLabel = (outcome: PolicyOutcome): string =>
  POLICY_OUTCOME_LABEL[outcome];

export type UpdateVerdict =
  | 'upToDate'
  /** A newer release exists and the app may continue without it. */
  | 'optional'
  /** The installed version is below the published minimum. */
  | 'mandatory'
  /** Nothing authoritative is known — not a claim that the app is current. */
  | 'unknown';

export interface UpdateDecision {
  verdict: UpdateVerdict;
  /** True only for `mandatory`; kept separate so the UI cannot invent a gate. */
  blocks: boolean;
  policy: ReleasePolicy | null;
  /** The policy came from the local cache because the fetch failed. */
  fromCache: boolean;
  outcome: PolicyOutcome;
}

const HEX64 = /^[0-9a-f]{64}$/;

const asString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

const asHex64 = (v: unknown): string | null => {
  const s = asString(v);
  if (!s) return null;
  const lower = s.toLowerCase();
  return HEX64.test(lower) ? lower : null;
};

/** An https URL, because an APK fetched over http can be replaced in transit. */
const asApkUrl = (v: unknown): string | null => {
  const s = asString(v);
  if (!s) return null;
  return /^https:\/\//i.test(s) ? s : null;
};

const asPositiveInt = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
};

/**
 * Parse the Firestore document. Deliberately strict: a policy missing a
 * checksum is not "a policy with no checksum", it is a policy that cannot
 * support a verified install, and guessing here is how an unverified APK ends
 * up on a user's phone.
 */
export const parseReleasePolicy = (
  raw: Record<string, unknown> | null | undefined,
): ReleasePolicy | null => {
  if (!raw) return null;
  const minimumSupportedVersion = asString(raw.minimumSupportedVersion);
  const latestVersion = asString(raw.latestVersion);
  const downloadUrl = asApkUrl(raw.apkUrl);
  const sha256 = asHex64(raw.apkSha256);
  // Required, not optional. A policy that names no signing certificate cannot
  // answer "who signed this file", and installing on that basis would be the
  // unknown-signing-identity case the release process is meant to refuse.
  const signingCertSha256 = asHex64(raw.signingCertSha256);
  if (
    !minimumSupportedVersion ||
    !latestVersion ||
    !downloadUrl ||
    !sha256 ||
    !signingCertSha256
  ) {
    return null;
  }
  // A minimum above the latest version is a publishing mistake that would
  // brick the app for everyone, so it is treated as no policy at all.
  if (compareVersions(latestVersion, minimumSupportedVersion) < 0) return null;
  const latestVersionCode = asPositiveInt(raw.latestVersionCode);
  const minimumSupportedVersionCode = asPositiveInt(raw.minimumSupportedVersionCode);
  // Same mistake, one dimension down: equal names with a minimum code above the
  // latest code locks every device out of an installable upgrade.
  if (
    latestVersion === minimumSupportedVersion &&
    compareVersionCodes(minimumSupportedVersionCode, latestVersionCode) > 0
  ) {
    return null;
  }

  return {
    minimumSupportedVersion,
    latestVersion,
    releaseNotes: asString(raw.releaseNotes) ?? '',
    publishedAt: asString(raw.publishedAt),
    downloadUrl,
    sha256,
    sizeBytes: asPositiveInt(raw.apkSizeBytes),
    signingCertSha256,
    latestVersionCode,
    minimumSupportedVersionCode,
  };
};

/**
 * Validate an already-parsed policy, e.g. one read back from local storage.
 *
 * The parsed shape and the Firestore document shape are different on purpose
 * (`sha256` vs `apkSha256`), so the document parser cannot be reused here — and
 * a cache entry must still be held to the same rules a fresh read is, or an
 * older or hand-edited cache file would smuggle a gate past the checks the
 * publisher is expected to satisfy.
 */
export const isReleasePolicy = (value: unknown): value is ReleasePolicy => {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.minimumSupportedVersion === 'string' &&
    p.minimumSupportedVersion.length > 0 &&
    typeof p.latestVersion === 'string' &&
    p.latestVersion.length > 0 &&
    typeof p.downloadUrl === 'string' &&
    /^https:\/\//i.test(p.downloadUrl) &&
    typeof p.sha256 === 'string' &&
    HEX64.test(p.sha256) &&
    typeof p.signingCertSha256 === 'string' &&
    HEX64.test(p.signingCertSha256)
  );
};

/**
 * Decide what the app should do about updates.
 *
 * The safety property that matters: `blocks` is only ever true from a policy
 * that was actually read (fresh, or cached inside the grace window). A failed
 * fetch, a missing document, or a malformed one yields `unknown`, which must
 * not be rendered as "up to date" and must not stop the app from opening —
 * otherwise an outage becomes a lockout for every legitimate user.
 */
export const decideUpdate = (input: {
  installedVersion: string;
  installedVersionCode?: number | null;
  outcome: PolicyOutcome;
  policy: ReleasePolicy | null;
  cached: { policy: ReleasePolicy; fetchedAtMs: number } | null;
  nowMs: number;
  graceMs: number;
}): UpdateDecision => {
  const { installedVersion, installedVersionCode, outcome, policy, cached, nowMs, graceMs } =
    input;

  const usable =
    outcome === 'ok' && policy
      ? { p: policy, fromCache: false }
      : outcome === 'unreachable' &&
          cached &&
          nowMs - cached.fetchedAtMs <= graceMs
        ? { p: cached.policy, fromCache: true }
        : null;

  if (!usable) {
    return {
      verdict: 'unknown',
      blocks: false,
      policy: policy ?? cached?.policy ?? null,
      fromCache: false,
      outcome,
    };
  }

  const { p, fromCache } = usable;
  // A policy cached by an older build has no code fields, and `undefined` must
  // not become a comparison — treat it as "the publisher did not say", which
  // leaves the version names deciding, exactly as it did before codes existed.
  const codeOf = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  const installed = {
    version: installedVersion,
    code: codeOf(installedVersionCode ?? null),
  };
  const verdict: UpdateVerdict = isNewerRelease(installed, {
    version: p.minimumSupportedVersion,
    code: codeOf(p.minimumSupportedVersionCode),
  })
    ? 'mandatory'
    : isNewerRelease(installed, {
        version: p.latestVersion,
        code: codeOf(p.latestVersionCode),
      })
      ? 'optional'
      : 'upToDate';

  return {
    verdict,
    blocks: verdict === 'mandatory',
    policy: p,
    fromCache,
    outcome,
  };
};

export type IntegrityReason =
  | 'ok'
  | 'no_expected_digest'
  | 'digest_mismatch'
  | 'package_mismatch'
  | 'signature_mismatch'
  | 'size_mismatch'
  | 'not_measured';

/**
 * Decide whether a downloaded APK may be handed to the installer.
 *
 * A finished download is not evidence of authenticity, so every expectation the
 * policy publishes has to be answered. `actual` being null means the native
 * inspection did not run or failed, which is a refusal, not a pass-through.
 */
export const evaluateApkIntegrity = (input: {
  policy: ReleasePolicy | null;
  actual: {
    sha256: string | null;
    packageName: string | null;
    signingCertSha256: string | null;
    sizeBytes: number | null;
  } | null;
  expectedPackageName: string;
}): { allowed: boolean; reason: IntegrityReason } => {
  const { policy, actual } = input;
  if (!policy || !actual) return { allowed: false, reason: 'not_measured' };

  if (!policy.sha256) return { allowed: false, reason: 'no_expected_digest' };

  if (
    !actual.sha256 ||
    actual.sha256.toLowerCase() !== policy.sha256.toLowerCase()
  ) {
    return { allowed: false, reason: 'digest_mismatch' };
  }

  if (actual.packageName !== input.expectedPackageName) {
    return { allowed: false, reason: 'package_mismatch' };
  }

  // The policy always carries a certificate, so an unreadable signature on the
  // downloaded file is a refusal. There is no branch here for "publisher did
  // not say who signed it", and that is deliberate.
  if (
    !actual.signingCertSha256 ||
    actual.signingCertSha256.toLowerCase() !==
      policy.signingCertSha256.toLowerCase()
  ) {
    return { allowed: false, reason: 'signature_mismatch' };
  }

  if (
    policy.sizeBytes != null &&
    actual.sizeBytes != null &&
    actual.sizeBytes !== policy.sizeBytes
  ) {
    return { allowed: false, reason: 'size_mismatch' };
  }

  return { allowed: true, reason: 'ok' };
};

/**
 * The update the modal shows, taken from the policy instead of from a second, independent release
 * lookup. Two sources of truth is how the boot gate could compare version codes against Firestore
 * while the screen beside it displayed a GitHub tag — the file that gets downloaded is named by
 * whichever one the download used, so both surfaces read the same document.
 *
 * `releaseUrl` is deliberately empty: a policy publishes a download, not a web page, and the UI
 * must not offer a link it does not have.
 */
export const policyUpdateInfo = (
  policy: ReleasePolicy,
  verdict: UpdateVerdict,
  installedVersion: string,
): UpdateInfo => ({
  hasUpdate: verdict === 'mandatory' || verdict === 'optional',
  currentVersion: installedVersion,
  latestVersion: policy.latestVersion,
  releaseNotes: policy.releaseNotes,
  releaseName: `Version ${policy.latestVersion}`,
  releaseDate: policy.publishedAt ?? '',
  downloadUrl: policy.downloadUrl,
  releaseUrl: '',
  assetSize: policy.sizeBytes,
});

/**
 * What a manual "check for updates" reports when it is not opening the modal.
 *
 * `unknown` is the verdict `decideUpdate` reaches without a usable policy, and it has to be said
 * as the reason it is unknown: a Firestore outage, a refused read, an absent document and a
 * malformed document are four different facts, and none of them is "you are up to date". This is
 * the same rule the boot gate follows silently, put into words on the screen that promises an
 * answer. A check that threw has no decision at all, which is reported as no answer too.
 */
export const describeManualUpdateCheck = (
  decision: UpdateDecision | null,
  latestVersion?: string | null,
): string => {
  if (!decision) return policyOutcomeLabel('unreachable');
  if (decision.verdict === 'upToDate') {
    const version = decision.policy?.latestVersion ?? latestVersion ?? null;
    return version
      ? `You're on the newest published release (v${version}).`
      : "You're on the newest published release.";
  }
  if (decision.verdict === 'optional' || decision.verdict === 'mandatory') {
    return 'An update is available.';
  }
  return policyOutcomeLabel(decision.outcome);
};
