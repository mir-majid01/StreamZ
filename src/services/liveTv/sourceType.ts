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
 * What "say nothing" actually buys, read out of the library rather than assumed:
 * `ReactExoplayerView.buildMediaSource` (line 1007, react-native-video 6.19.2) resolves the
 * source type as
 *
 *   type = Util.inferContentType(!TextUtils.isEmpty(overrideExtension)
 *          ? "." + overrideExtension : uri.getLastPathSegment());
 *
 * and media3 1.11.1's `inferContentType` recognises exactly four extensions — `mpd`, `m3u8`,
 * `ism`, `isml` (verified with `javap -c` over `androidx.media3.common.util.Util` from the AAR
 * the build resolves). Anything else, including a URL with no extension at all, comes back as
 * `CONTENT_TYPE_OTHER`, which this library turns into a `ProgressiveMediaSource`. So silence is
 * not inference: it is a container reader that cannot parse an HLS playlist. A `Content-Type`
 * header is the one signal that can do better, and the player has no way to receive one — the
 * only channel the native layer offers is this string — which is why the probe result is
 * accepted here and the extension heuristic stays the fallback.
 */
import {
  containerHintFromProbe,
  type StreamProbeResult,
} from '@/src/services/liveTv/streamProbe';

export type LiveSourceType = 'm3u8' | 'mpd' | undefined;

export const liveSourceType = (
  url: string,
  probe?: StreamProbeResult | null,
): LiveSourceType => {
  // An answer from the server outranks a filename: it is what the URL is serving now, rather
  // than what somebody called it when the playlist entry was written. Null unless the probe
  // honestly saw a media content type.
  const observed = containerHintFromProbe(probe);
  if (observed === 'm3u8') return 'm3u8';
  if (observed === 'mpd') return 'mpd';
  if (observed === 'progressive') return undefined;

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
  // always serve, and because the alternative — saying nothing — is what media3 reads as
  // "progressive container", which cannot play an HLS playlist at all. `.m3u` needs the hint
  // for the same reason: media3's four recognised extensions do not include it.
  return 'm3u8';
};

