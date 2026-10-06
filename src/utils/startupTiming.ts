/**
 * Startup timing marks for the cold-start budget (PRD §31). Imported first from
 * index.ts so the epoch is bundle-evaluation start, and read from logcat with:
 *   adb logcat -s ReactNativeJS | findstr [startup]
 * Marks are plain logs on purpose: they must exist in release builds too, since
 * the numbers that matter are the ones a real device produces, not a dev session.
 */
const T0 = Date.now();

export const bootT0 = T0;

export function mark(name: string): void {
  console.log(`[startup] ${name} +${Date.now() - T0}ms`);
}
