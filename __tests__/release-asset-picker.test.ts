/**
 * Which APK a GitHub release points the updater at.
 *
 * This is the one place a wrong choice cannot be undone by a checksum: the digest
 * is computed over whatever URL was picked, so a mis-picked asset verifies against
 * a policy that describes it and installs anyway. The picker therefore has to
 * refuse rather than settle.
 */
import { findApkAsset } from '@/src/services/UpdateService';

const asset = (name: string) =>
  ({ name, browser_download_url: `https://dl.example/${name}`, size: 1 }) as never;

describe('findApkAsset', () => {
  it('takes the asset that says it is a release build', () => {
    expect(
      findApkAsset([asset('streamz-release-0.2.0.apk'), asset('notes.txt')])?.name,
    ).toBe('streamz-release-0.2.0.apk');
    expect(findApkAsset([asset('app-release.apk')])?.name).toBe('app-release.apk');
    expect(findApkAsset([asset('streamz-universal.apk')])?.name).toBe('streamz-universal.apk');
  });

  it('never falls back to an arbitrary apk', () => {
    // The old rule accepted any filename that did not contain "debug", which made
    // this list resolve to whichever asset happened to be first.
    expect(findApkAsset([asset('mystery.apk'), asset('streamz-release-0.2.0.apk')])?.name).toBe(
      'streamz-release-0.2.0.apk',
    );
    expect(findApkAsset([asset('mystery.apk')])).toBeNull();
    expect(findApkAsset([asset('streamz-0.2.0-android-x86_64.apk')])).toBeNull();
  });

  it('rejects debug builds even when they are the only apk attached', () => {
    expect(findApkAsset([asset('app-debug.apk')])).toBeNull();
    expect(findApkAsset([asset('StreamZ-DEBUG.apk')])).toBeNull();
  });

  it('is deterministic when a release attaches several release-shaped apk files', () => {
    const a = findApkAsset([asset('zzz-release.apk'), asset('aaa-release.apk')])?.name;
    const b = findApkAsset([asset('aaa-release.apk'), asset('zzz-release.apk')])?.name;
    expect(a).toBe('aaa-release.apk');
    expect(b).toBe(a);
  });

  it('ignores non-apk assets and an empty release', () => {
    expect(findApkAsset([asset('mapping.txt'), asset('streamz.ipa')])).toBeNull();
    expect(findApkAsset([])).toBeNull();
  });

  it('does not read a release token out of the middle of an unrelated word', () => {
    // "release" has to be its own segment, or a file named for something else
    // would be chosen because a substring happened to appear.
    expect(findApkAsset([asset('sourcerelease.apk')])).toBeNull();
    expect(findApkAsset([asset('streamz-release-notes.apk')])?.name).toBe(
      'streamz-release-notes.apk',
    );
  });
});
