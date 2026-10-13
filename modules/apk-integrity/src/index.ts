import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * What the device could actually measure about a file on disk. Every field is nullable because a
 * measurement that failed is not a measurement of zero — the caller refuses on null rather than
 * treating "unknown" as "verified".
 */
export interface ApkMeasurements {
  sha256: string | null;
  packageName: string | null;
  signingCertSha256: string | null;
  sizeBytes: number | null;
}

interface NativeApkIntegrity {
  inspectApk(path: string): Promise<Partial<ApkMeasurements> | null>;
}

// Resolved lazily: the native side only exists on Android, and touching it at module scope would
// throw in Jest and on web long before any update code had a chance to run.
let nativeModule: NativeApkIntegrity | null | undefined;

const getNative = (): NativeApkIntegrity | null => {
  if (nativeModule !== undefined) return nativeModule;
  if (Platform.OS !== 'android') {
    nativeModule = null;
    return nativeModule;
  }
  try {
    nativeModule = requireNativeModule('ExpoApkIntegrity') as NativeApkIntegrity;
  } catch {
    nativeModule = null;
  }
  return nativeModule;
};

/**
 * `java.io.File` needs a filesystem path. Files the app wrote for itself through
 * `expo-file-system` arrive as `file://` URIs, so the scheme is stripped here rather than handing
 * a URI to a native API that would not understand it.
 */
const toFsPath = (uriOrPath: string): string =>
  uriOrPath.startsWith('file://') ? uriOrPath.slice('file://'.length) : uriOrPath;

/** False when the platform, the build, or the link is missing the native verifier. */
export const apkIntegrityAvailable = (): boolean => getNative() !== null;

/**
 * Hash the file, read the package name it declares, and fingerprint the certificate that signed
 * it — or `null` when the device cannot answer, which the caller must treat as a refusal.
 */
export const inspectApk = async (
  uriOrPath: string,
): Promise<ApkMeasurements | null> => {
  const native = getNative();
  if (!native) return null;
  try {
    const report = await native.inspectApk(toFsPath(uriOrPath));
    if (!report) return null;
    return {
      sha256: report.sha256 ?? null,
      packageName: report.packageName ?? null,
      signingCertSha256: report.signingCertSha256 ?? null,
      sizeBytes: typeof report.sizeBytes === 'number' ? report.sizeBytes : null,
    };
  } catch {
    return null;
  }
};
