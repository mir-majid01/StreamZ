/**
 * The owner's rule for the updater: a viewer updates or leaves. There is no skip, no "Later",
 * and no back-gesture escape while an update is on offer.
 *
 * These assert the wiring, because Jest cannot render this tree (it reaches for
 * `expo-file-system` and native modules on import). What the dialog actually looks like still
 * needs a device — nothing here claims to have seen it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const MODAL = read('src/components/UpdateModal.tsx');
const CHECKER = read('src/components/UpdateChecker.tsx');
const SPLASH = read('src/screens/SplashScreen.tsx');

describe('the update dialog cannot be talked out of the update', () => {
  it('offers no skip and no later', () => {
    expect(MODAL).not.toContain('Skip this version');
    expect(MODAL).not.toContain('onSkipVersion');
    expect(MODAL).not.toMatch(/>\s*Later\s*</);
  });

  it('gates dismissal on an update being on offer, not on a caller-supplied flag', () => {
    expect(MODAL).toMatch(/const blocked = BLOCKING_STATES\.includes\(state\)/);
    expect(MODAL).toMatch(/onRequestClose=\{\(\) => \{\s*if \(!blocked\) onClose\(\);/);
    // The close glyph only exists when nothing is being asked of the viewer.
    expect(MODAL).toMatch(/\{!blocked && \(\s*<Focusable\s+onPress=\{onClose\}/);
  });

  it('covers every state in which an update is actually presented', () => {
    const listed = MODAL.match(/const BLOCKING_STATES[^=]+=\s*\[([\s\S]*?)\]/)?.[1] ?? '';
    const states = [...listed.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
    for (const required of ['available', 'downloading', 'verifying', 'installing', 'downloaded', 'needsPermission', 'refused']) {
      expect(states).toContain(required);
    }
    // A dialog that found nothing, or failed to look, must still be closable.
    expect(states).not.toContain('up-to-date');
    expect(states).not.toContain('error');
  });

  it('gives the only alternative a real exit, and never a dead button', () => {
    expect(MODAL).toMatch(/onExit = \(\) => \{\s*BackHandler\.exitApp\(\);/);
    expect(MODAL).toContain('Exit app');
  });
});

describe('a skip recorded by an older build cannot strand a device', () => {
  it('is cleared on the background check path', () => {
    expect(CHECKER).toContain('await clearSkippedVersion()');
    expect(CHECKER).not.toMatch(/if \(!force && \(await isSkippedVersion/);
  });

  it('is cleared on the boot path instead of being honoured', () => {
    expect(SPLASH).toContain('await clearSkippedVersion()');
    expect(SPLASH).not.toContain('isSkippedVersion');
  });
});
