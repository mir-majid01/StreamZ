/**
 * Which media source the player should build for a live channel URL.
 *
 * Measured across the three configured playlists (13,389 entries): 12,706 end in `.m3u8`,
 * 524 carry no extension, 148 are `.mpd`, 5 end in `.m3u`, and 6 are a progressive or raw
 * container (4 `.ts`, 2 `.mp4`). The player used to answer with a hint for all of them: the
 * only test was "does the URL contain `.mpd` followed by `?` or the end". That was right for
 * the DASH entries and wrong for the 6 progressive ones, and because react-native-video
 * builds the ExoPlayer media source from this hint and never sniffs the response, a
 * progressive file reached the HLS parser and failed as a malformed playlist instead of
 * playing.
 *
 * Say nothing when the container is not a playlist: inference is what every other source in
 * the app already gets.
 */
export type LiveSourceType = 'm3u8' | 'mpd' | undefined;

export const liveSourceType = (url: string): LiveSourceType => {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // A relative or malformed entry still deserves extension matching on the raw string.
  }
  const clean = path.split('?')[0].toLowerCase();
  if (clean.endsWith('.mpd')) return 'mpd';
  if (/\.(mp4|mkv|webm|mov|ts)$/.test(clean)) return undefined;
  // `.m3u8` (96.45% of iptv-org, 86.16% of Free-TV), `.m3u`, and the 524 extensionless
  // entries. Extensionless is answered as HLS because that is what these catalogues almost
  // always serve and one sampled extensionless URL did answer with an HLS content type.
  return 'm3u8';
};
