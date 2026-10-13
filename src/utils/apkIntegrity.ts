/**
 * The app-facing name for the local `apk-integrity` Expo Module. The implementation lives with
 * the native code it calls (`modules/apk-integrity`); this exists so app code can keep importing
 * from `@/src/utils/...` without a path into the modules directory.
 */
export {
  apkIntegrityAvailable,
  inspectApk,
  type ApkMeasurements,
} from '../../modules/apk-integrity/src';
