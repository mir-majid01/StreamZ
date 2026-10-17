/**
 * The update gate compares what is installed against what is published, so an
 * arithmetic mistake here is the difference between a user being offered a real
 * upgrade and being told they are current forever. Two bugs are pinned: the old
 * `MAJOR*1e6 + MINOR*1e3 + PATCH` encoding aliased `1.1000.0` onto `2.0.0` and
 * dropped a fourth component, and `versionCode` — the number Android actually
 * refuses to downgrade — took no part in the decision at all.
 */
import {
  compareVersionCodes,
  compareVersions,
  isNewerRelease,
} from '@/src/utils/versions';
import { decideUpdate, parseReleasePolicy } from '@/src/utils/releasePolicy';

const policyDoc = (over: Record<string, unknown> = {}) => ({
  minimumSupportedVersion: '0.1.0',
  latestVersion: '0.2.0',
  apkUrl: 'https://dl.example/streamz-0.2.0.apk',
  apkSha256: 'a'.repeat(64),
  signingCertSha256: 'b'.repeat(64),
  releaseNotes: '',
  apkSizeBytes: 43596487,
  ...over,
});

const decide = (
  installedVersion: string,
  policy: Record<string, unknown>,
  installedVersionCode: number | null = null,
) =>
  decideUpdate({
    installedVersion,
    installedVersionCode,
    outcome: 'ok',
    policy: parseReleasePolicy(policy),
    cached: null,
    nowMs: 1,
    graceMs: 0,
  });

describe('compareVersions', () => {
  it('orders numerically, not lexicographically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('does not alias a large component onto the next one', () => {
    // The old encoding made these equal.
    expect(compareVersions('1.1000.0', '2.0.0')).toBe(-1);
    expect(compareVersions('0.0.1000', '0.1.0')).toBe(-1);
  });

  it('keeps a fourth component instead of dropping it', () => {
    expect(compareVersions('1.0.0.1', '1.0.0')).toBe(1);
    expect(compareVersions('1.0.0.2', '1.0.0.10')).toBe(-1);
  });

  it('treats a pre-release suffix as the same release, and tolerates junk', () => {
    expect(compareVersions('1.2.3-beta', '1.2.3')).toBe(0);
    expect(compareVersions('v1.2', '1.2.0')).toBe(0);
    expect(compareVersions('', '0.0.0')).toBe(0);
    expect(compareVersions('1.x.3', '1.0.3')).toBe(0);
  });
});

describe('isNewerRelease', () => {
  it('lets the version name decide when it differs', () => {
    expect(isNewerRelease({ version: '0.1.0', code: 9 }, { version: '0.2.0', code: 1 })).toBe(true);
    expect(isNewerRelease({ version: '0.2.0', code: 1 }, { version: '0.1.0', code: 99 })).toBe(false);
  });

  it('uses the code when the names are equal', () => {
    expect(isNewerRelease({ version: '0.1.0', code: 1 }, { version: '0.1.0', code: 2 })).toBe(true);
    expect(isNewerRelease({ version: '0.1.0', code: 2 }, { version: '0.1.0', code: 1 })).toBe(false);
    expect(isNewerRelease({ version: '0.1.0', code: 2 }, { version: '0.1.0', code: 2 })).toBe(false);
  });

  it('claims nothing when either side has no code', () => {
    expect(isNewerRelease({ version: '0.1.0', code: null }, { version: '0.1.0', code: 7 })).toBe(false);
    expect(isNewerRelease({ version: '0.1.0', code: 7 }, { version: '0.1.0', code: null })).toBe(false);
  });

  it('compares codes without inventing a difference from nulls', () => {
    expect(compareVersionCodes(null, 5)).toBe(0);
    expect(compareVersionCodes(5, null)).toBe(0);
    expect(compareVersionCodes(6, 5)).toBe(1);
  });
});

describe('parseReleasePolicy with version codes', () => {
  it('keeps them when present and nulls them when absent', () => {
    const withCodes = parseReleasePolicy(
      policyDoc({ latestVersionCode: 4, minimumSupportedVersionCode: 2 }),
    );
    expect(withCodes).toMatchObject({ latestVersionCode: 4, minimumSupportedVersionCode: 2 });
    const without = parseReleasePolicy(policyDoc());
    expect(without).toMatchObject({ latestVersionCode: null, minimumSupportedVersionCode: null });
  });

  it('refuses a minimum code above the latest code under one name', () => {
    // Same shape as the "minimum above latest" lockout, one dimension down.
    expect(
      parseReleasePolicy(
        policyDoc({
          minimumSupportedVersion: '0.2.0',
          latestVersion: '0.2.0',
          minimumSupportedVersionCode: 9,
          latestVersionCode: 5,
        }),
      ),
    ).toBeNull();
  });

  it('ignores a non-positive or non-numeric code rather than reading it as zero', () => {
    const parsed = parseReleasePolicy(policyDoc({ latestVersionCode: 0 }));
    expect(parsed?.latestVersionCode).toBeNull();
  });
});

describe('decideUpdate with version codes', () => {
  it('offers an update that shares the installed name but has a higher code', () => {
    // The CI builds every APK as 0.1.0 / code 1, so this is the real shape of a
    // re-release: identical name, newer code, and the old gate said "up to date".
    const d = decide('0.1.0', policyDoc({ latestVersion: '0.1.0', latestVersionCode: 2 }), 1);
    expect(d.verdict).toBe('optional');
    expect(d.blocks).toBe(false);
  });

  it('still refuses to call an equal name and equal code an update', () => {
    const d = decide('0.1.0', policyDoc({ latestVersion: '0.1.0', latestVersionCode: 2 }), 2);
    expect(d.verdict).toBe('upToDate');
  });

  it('makes mandatory when the minimum code is above the installed code', () => {
    const d = decide(
      '0.1.0',
      policyDoc({
        minimumSupportedVersion: '0.1.0',
        latestVersion: '0.2.0',
        minimumSupportedVersionCode: 3,
      }),
      2,
    );
    expect(d.verdict).toBe('mandatory');
    expect(d.blocks).toBe(true);
  });

  it('behaves exactly as before when the policy carries no codes', () => {
    expect(decide('0.1.0', policyDoc()).verdict).toBe('optional');
    expect(decide('0.2.0', policyDoc()).verdict).toBe('upToDate');
    expect(decide('0.0.9', policyDoc()).verdict).toBe('mandatory');
  });

  it('does not read a missing code on the installed side as version 0', () => {
    const d = decide('0.1.0', policyDoc({ latestVersion: '0.1.0', latestVersionCode: 2 }), null);
    expect(d.verdict).toBe('upToDate');
  });
});
