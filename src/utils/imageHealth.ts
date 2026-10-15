/**
 * Poster images are fire-and-forget native requests: they never pass through the
 * code that fetched the catalogue, so a blocked image CDN is invisible to the feed
 * and indistinguishable from a title that has no artwork. The cards that fail
 * report here, and Home says so out loud instead of showing grey boxes.
 */
type Listener = (failures: number) => void;

/**
 * One bad poster is TMDB data, not an outage. Three is a pattern worth telling
 * the user about.
 */
export const POSTER_FAILURE_THRESHOLD = 3;

let failures = 0;
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener(failures);
};

export const reportImageFailure = (): void => {
  failures += 1;
  emit();
};

/**
 * Deliberately monotonic for the life of the process. A refresh does not make
 * already-mounted cards re-request, so clearing the count would promise artwork
 * that is not coming back; instead, cards mounted after a recovered CDN simply
 * stop adding to it.
 */
export const subscribeImageHealth = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(failures);
  return () => {
    listeners.delete(listener);
  };
};
