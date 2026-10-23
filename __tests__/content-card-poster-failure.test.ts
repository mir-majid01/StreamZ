/**
 * A poster that failed once used to stay failed for whatever title came next in the same card.
 *
 * The assertion here is on the wiring, not on pixels: this suite does not render components (no
 * test in it does), and the defect is exactly a piece of state that outlives the value it
 * describes. Keying the failure to the URL is what makes that impossible, so the test checks the
 * state is a URL, is compared to the current URL, and is what `onError` writes.
 */
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const card = readFileSync(path.join(ROOT, 'src/components/ContentCard.tsx'), 'utf8');

describe('a poster failure belongs to a URL, not to a card', () => {
  it('records which URL failed instead of a flag that outlives the item', () => {
    expect(card).toContain('useState<string | null>(null)');
    expect(card).toContain('failedUrl === posterUrl');
    // The boolean this replaced is what caused the stale fallback: it never learned the item moved.
    expect(card).not.toMatch(/useState\(false\)/);
    expect(card).not.toMatch(/const \[imageFailed/);
  });

  it('writes the failing URL, so a different poster is not born broken', () => {
    const at = card.indexOf('onError=');
    expect(at).toBeGreaterThan(-1);
    const handler = card.slice(at, card.indexOf('}}', at) + 2);
    expect(handler).toContain('setFailedUrl(posterUrl)');
    expect(handler).toContain('reportImageFailure()');
  });

  it('keeps the box sized before the image arrives, so rows cannot jump', () => {
    expect(card).toContain('width * POSTER_ASPECT_RATIO');
    const box = card.slice(card.indexOf('<Box'), card.indexOf('showFallback ?'));
    expect(box).toContain('style={{ width, height }}');
  });
});
