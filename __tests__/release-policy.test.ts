import {
  decideUpdate,
  evaluateApkIntegrity,
  parseReleasePolicy,
  type ReleasePolicy,
} from '@/src/utils/releasePolicy';
import { compareVersions } from '@/src/utils/versions';

const SHA = 'a'.repeat(64);
const CERT = 'b'.repeat(64);

const doc = (over: Record<string, unknown> = {}) => ({
  minimumSupportedVersion: '2.0.0',
  latestVersion: '2.3.0',
  releaseNotes: 'Fixes',
  publishedAt: '2026-10-01T00:00:00Z',
  apkUrl: 'https://github.com/mir-majid01/StreamZ/releases/download/v2.3.0/app-release.apk',
  apkSha256: SHA,
  apkSizeBytes: 43565205,
  signingCertSha256: CERT,
  ...over,
});

const POLICY = parseReleasePolicy(doc()) as ReleasePolicy;

const HOUR = 3_600_000;

const decide = (over: Partial<Parameters<typeof decideUpdate>[0]> = {}) =>
  decideUpdate({
    installedVersion: '2.0.0',
    outcome: 'ok',
    policy: POLICY,
    cached: null,
    nowMs: 10 * HOUR,
    graceMs: 72 * HOUR,
    ...over,
  });

describe('compareVersions', () => {
  it('orders by number, not by string', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.1-beta', '2.0.1')).toBe(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
  });
});

describe('parseReleasePolicy', () => {
  it('accepts a complete document', () => {
    expect(POLICY.sha256).toBe(SHA);
    expect(POLICY.sizeBytes).toBe(43565205);
  });

  it('refuses a policy with nothing to verify the download against', () => {
    expect(parseReleasePolicy(doc({ apkSha256: '' }))).toBeNull();
    expect(parseReleasePolicy(doc({ apkSha256: 'not-hex' }))).toBeNull();
    expect(parseReleasePolicy(doc({ apkSha256: 'a'.repeat(63) }))).toBeNull();
    expect(parseReleasePolicy(doc({ apkSha256: null }))).toBeNull();
  });

  it('normalises case so a publisher can paste an upper-case digest', () => {
    const parsed = parseReleasePolicy(doc({ apkSha256: 'A'.repeat(64) }));
    expect(parsed?.sha256).toBe(SHA);
  });

  it('refuses an http download URL', () => {
    expect(
      parseReleasePolicy(
        doc({ apkUrl: 'http://example.com/app.apk' }),
      ),
    ).toBeNull();
  });

  it('treats a minimum above the latest version as no policy at all', () => {
    // Honouring it would lock every installed device out of the app.
    expect(
      parseReleasePolicy(doc({ minimumSupportedVersion: '9.9.9' })),
    ).toBeNull();
  });

  it('refuses a policy that does not name a signing certificate', () => {
    // Absent and malformed are both refusals: a policy with no stated signer
    // would leave the installer checking a digest that any key could produce.
    expect(parseReleasePolicy(doc({ signingCertSha256: null }))).toBeNull();
    expect(parseReleasePolicy(doc({ signingCertSha256: '' }))).toBeNull();
    expect(parseReleasePolicy(doc({ signingCertSha256: 'zz' }))).toBeNull();
    expect(parseReleasePolicy(doc({ signingCertSha256: 'b'.repeat(63) }))).toBeNull();
  });

  it('accepts an upper-case certificate the same way it does a digest', () => {
    const parsed = parseReleasePolicy(doc({ signingCertSha256: 'B'.repeat(64) }));
    expect(parsed?.signingCertSha256).toBe(CERT);
  });
});

describe('decideUpdate', () => {
  it('blocks exactly at "older than the minimum"', () => {
    expect(decide({ installedVersion: '1.9.9' }).verdict).toBe('mandatory');
    expect(decide({ installedVersion: '1.9.9' }).blocks).toBe(true);
    expect(decide({ installedVersion: '2.0.0' }).verdict).toBe('optional');
    expect(decide({ installedVersion: '2.0.0' }).blocks).toBe(false);
  });

  it('offers, but does not force, a version that is merely behind', () => {
    const d = decide({ installedVersion: '2.2.0' });
    expect(d.verdict).toBe('optional');
    expect(d.blocks).toBe(false);
  });

  it('calls a version at or beyond the latest up to date', () => {
    expect(decide({ installedVersion: '2.3.0' }).verdict).toBe('upToDate');
    expect(decide({ installedVersion: '2.4.0' }).verdict).toBe('upToDate');
  });

  it('uses a cached policy only while offline, and only inside the grace window', () => {
    const fresh = decide({
      outcome: 'unreachable',
      policy: null,
      cached: { policy: POLICY, fetchedAtMs: 8 * HOUR },
    });
    expect(fresh.verdict).toBe('optional');
    expect(fresh.fromCache).toBe(true);

    const stale = decide({
      outcome: 'unreachable',
      policy: null,
      cached: { policy: POLICY, fetchedAtMs: 10 * HOUR - 73 * HOUR },
    });
    expect(stale.verdict).toBe('unknown');
    expect(stale.blocks).toBe(false);
  });

  it('never trusts the cache when the read itself changed meaning', () => {
    // A cached minimum must not keep enforcing a gate after the policy stops
    // being readable for a non-network reason: forbidden means the rules moved,
    // missing means the owner withdrew the release.
    for (const outcome of ['forbidden', 'missing', 'malformed'] as const) {
      const d = decide({
        outcome,
        policy: null,
        cached: { policy: POLICY, fetchedAtMs: 9 * HOUR },
      });
      expect(d.verdict).toBe('unknown');
      expect(d.fromCache).toBe(false);
    }
  });

  it('reports a failed read as unknown rather than as up to date', () => {
    const d = decide({ outcome: 'unreachable', policy: null, cached: null });
    expect(d.verdict).toBe('unknown');
    expect(d.verdict).not.toBe('upToDate');
  });

  it('keeps a parsed-but-null policy from blocking anything', () => {
    const d = decide({ outcome: 'ok', policy: null });
    expect(d.verdict).toBe('unknown');
    expect(d.blocks).toBe(false);
  });
});

describe('evaluateApkIntegrity', () => {
  const measured = {
    sha256: SHA,
    packageName: 'stream.z',
    signingCertSha256: CERT,
    sizeBytes: 43565205,
  };

  it('allows only a file that answers every published expectation', () => {
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: measured,
        expectedPackageName: 'stream.z',
      }),
    ).toEqual({ allowed: true, reason: 'ok' });
  });

  it('refuses when the native inspection did not produce a measurement', () => {
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: null,
        expectedPackageName: 'stream.z',
      }).reason,
    ).toBe('not_measured');
  });

  it('refuses a different package, which is the sheeshcake/Flickv4 case', () => {
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: { ...measured, packageName: 'com.sheeshcake.flick' },
        expectedPackageName: 'stream.z',
      }).reason,
    ).toBe('package_mismatch');
  });

  it('refuses a digest or signature that does not match', () => {
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: { ...measured, sha256: 'c'.repeat(64) },
        expectedPackageName: 'stream.z',
      }).reason,
    ).toBe('digest_mismatch');
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: { ...measured, signingCertSha256: null },
        expectedPackageName: 'stream.z',
      }).reason,
    ).toBe('signature_mismatch');
  });

  it('refuses a truncated download even when the digest still matched', () => {
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: { ...measured, sizeBytes: 43565204 },
        expectedPackageName: 'stream.z',
      }).reason,
    ).toBe('size_mismatch');
  });

  it('refuses a file signed by a certificate other than the published one', () => {
    // The sheeshcake/Flickv4 hazard in the other direction: a real, correctly
    // hashed APK that was signed by somebody else's key.
    expect(
      evaluateApkIntegrity({
        policy: POLICY,
        actual: { ...measured, signingCertSha256: 'c'.repeat(64) },
        expectedPackageName: 'stream.z',
      }).reason,
    ).toBe('signature_mismatch');
  });
});
