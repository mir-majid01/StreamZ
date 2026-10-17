import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  POLICY_OUTCOME_LABEL,
  decideUpdate,
  describeManualUpdateCheck,
  parseReleasePolicy,
  policyOutcomeLabel,
  policyUpdateInfo,
  type PolicyOutcome,
  type ReleasePolicy,
  type UpdateVerdict,
} from '@/src/utils/releasePolicy';

/**
 * The manual "Check for updates" row and the release-policy seam behind it. Two defects are being
 * held shut here: the Settings path used to open the modal with no policy at all (so the verified
 * in-app install could never be offered and a second, independent release lookup answered for the
 * release), and every non-`ok` outcome was one step away from being displayed as "you are up to
 * date" — which is a verdict the backend never issued.
 */

const SHA = 'a'.repeat(64);
const CERT = 'b'.repeat(64);

const doc = (over: Record<string, unknown> = {}) => ({
  minimumSupportedVersion: '2.0.0',
  latestVersion: '2.3.0',
  releaseNotes: 'Two fixes and a change',
  publishedAt: '2026-10-01T00:00:00Z',
  apkUrl: 'https://github.com/mir-majid01/StreamZ/releases/download/v2.3.0/app-release.apk',
  apkSha256: SHA,
  apkSizeBytes: 43565205,
  signingCertSha256: CERT,
  ...over,
});

const POLICY = parseReleasePolicy(doc()) as ReleasePolicy;

const decision = (
  verdict: UpdateVerdict,
  installedVersion: string,
  outcome: PolicyOutcome = 'ok',
) =>
  decideUpdate({
    installedVersion,
    installedVersionCode: null,
    outcome,
    policy: outcome === 'ok' ? POLICY : null,
    cached: null,
    nowMs: Date.parse('2026-10-17T00:00:00Z'),
    graceMs: 60_000,
  });

describe('the update shown is the update decided on', () => {
  it('derives every view field from the policy document', () => {
    const info = policyUpdateInfo(POLICY, 'optional', '2.0.0');
    expect(info.latestVersion).toBe(POLICY.latestVersion);
    expect(info.downloadUrl).toBe(POLICY.downloadUrl);
    expect(info.assetSize).toBe(POLICY.sizeBytes);
    expect(info.releaseNotes).toBe(POLICY.releaseNotes);
    expect(info.releaseDate).toBe(POLICY.publishedAt);
  });

  it('names no release web page it does not have', () => {
    // A policy publishes a download. Offering `releaseUrl` would send the user to a GitHub release
    // page the publisher may never have created — the repo had none at the time this shipped.
    expect(policyUpdateInfo(POLICY, 'optional', '2.0.0').releaseUrl).toBe('');
  });

  it('reports the current version as the version the comparison used', () => {
    expect(policyUpdateInfo(POLICY, 'optional', '2.0.0').currentVersion).toBe('2.0.0');
    expect(policyUpdateInfo(POLICY, 'mandatory', '1.4.2').currentVersion).toBe('1.4.2');
  });

  it('claims an update only for the two verdicts that are one', () => {
    // `hasUpdate: true` used to be hardcoded for the boot path; a modal that says "update
    // available" while the decision says otherwise is a lie about the user's device.
    expect(policyUpdateInfo(POLICY, 'optional', '2.0.0').hasUpdate).toBe(true);
    expect(policyUpdateInfo(POLICY, 'mandatory', '1.0.0').hasUpdate).toBe(true);
    expect(policyUpdateInfo(POLICY, 'upToDate', '2.3.0').hasUpdate).toBe(false);
    expect(policyUpdateInfo(POLICY, 'unknown', '2.0.0').hasUpdate).toBe(false);
  });
});

describe('a manual check says what was observed, and nothing more', () => {
  it('tells an up-to-date device which release it matched', () => {
    const line = describeManualUpdateCheck(decision('upToDate', '2.3.0'));
    expect(line).toMatch(/newest published release/);
    expect(line).toContain('2.3.0');
  });

  it('points at an update without pre-telling the user what to do about it', () => {
    expect(describeManualUpdateCheck(decision('optional', '2.0.0'))).toBe(
      'An update is available.',
    );
    expect(describeManualUpdateCheck(decision('mandatory', '1.0.0'))).toBe(
      'An update is available.',
    );
  });

  // The heart of it: four different ways to learn nothing must not collapse into one sentence,
  // and none of them may be reported as being current.
  const NON_OK: readonly PolicyOutcome[] = ['missing', 'forbidden', 'unreachable', 'malformed'];

  it.each(NON_OK)('calls an %s outcome by name', (outcome) => {
    const line = describeManualUpdateCheck(decision('unknown', '2.0.0', outcome));
    expect(line).toBe(POLICY_OUTCOME_LABEL[outcome]);
    expect(line.length).toBeGreaterThan(20);
  });

  it.each(NON_OK)('never reads an %s outcome as up to date', (outcome) => {
    const line = describeManualUpdateCheck(decision('unknown', '2.0.0', outcome));
    expect(line).not.toMatch(/up to date|newest|latest/i);
  });

  it('keeps the four failure sentences distinct', () => {
    const lines = NON_OK.map((outcome) => policyOutcomeLabel(outcome));
    expect(new Set(lines).size).toBe(NON_OK.length);
  });

  it('does not blame the connection for a release nobody published', () => {
    expect(policyOutcomeLabel('missing')).not.toMatch(/connection|offline|reach/i);
    expect(policyOutcomeLabel('unreachable')).toMatch(/connection|reach/i);
  });

  it('does not call a refused read a missing release', () => {
    // A rules change and an absent document are different events; conflating them would send the
    // owner to publish a release that already exists.
    expect(policyOutcomeLabel('forbidden')).not.toBe(policyOutcomeLabel('missing'));
    expect(policyOutcomeLabel('forbidden')).toMatch(/allowed/i);
  });

  it('reports a check that threw as unreachable, not as a verdict', () => {
    // `evaluateReleasePolicy` rejecting is handled by the caller as `null`; the sentence has to be
    // the no-answer one, never `not_found`-style copy.
    const line = describeManualUpdateCheck(null);
    expect(line).toBe(POLICY_OUTCOME_LABEL.unreachable);
    expect(line).not.toMatch(/invalid|expired|revoked|up to date/i);
  });

  it('has a sentence for the one outcome that is not a failure', () => {
    expect(policyOutcomeLabel('ok')).toBe('The published release was read.');
  });
});

describe('the settings row is wired to the policy, not to a second release lookup', () => {
  // Read as source because a screen cannot be imported into this Jest setup (`react-native-css`
  // throws at import). These are the lines that make the seam real; deleting any of them is what
  // would put the manual check back on the GitHub release list.
  const screen = readFileSync(
    join(process.cwd(), 'src', 'screens', 'SettingsScreen.tsx'),
    'utf8',
  );

  it('runs the policy read on press', () => {
    expect(screen).toContain('evaluateReleasePolicy()');
    expect(screen).toContain('describeManualUpdateCheck(decision)');
  });

  it('hands the modal the policy it just read', () => {
    expect(screen).toMatch(/policy=\{updatePolicy\}/);
    expect(screen).toMatch(/initialUpdateInfo=\{updateInfo\}/);
  });

  it('cannot open the modal on a verdict that is not an update', () => {
    const opener = screen.slice(screen.indexOf('const runUpdateCheck'), screen.indexOf('const toast'));
    expect(opener).toMatch(/setUpdaterOpen\(true\)/);
    // The only `setUpdaterOpen(true)` in that body sits inside the optional/mandatory branch.
    expect((opener.match(/setUpdaterOpen\(true\)/g) ?? []).length).toBe(1);
    expect(opener).toMatch(/decision\.verdict === 'optional' \|\| decision\.verdict === 'mandatory'/);
  });

  it('reports the version it compared against, not a display string from elsewhere', () => {
    expect(screen).toContain('installedReleaseVersion()');
  });
});
