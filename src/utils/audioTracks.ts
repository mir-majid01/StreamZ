import type { AudioTrack } from 'react-native-video';

export interface AudioTrackOption {
  /** The player's own index, what `selectedAudioTrack: {type:'index'}` expects. */
  index: number;
  label: string;
}

/**
 * Turn the player's track list into picker options.
 *
 * A track is named exactly as far as the stream named it: title, then language,
 * then a neutral position. Labeling an unnamed track "English" would advertise
 * audio the app has no evidence for, which is the same mistake the server list
 * used to make.
 */
export const toAudioTrackOptions = (tracks: AudioTrack[]): AudioTrackOption[] =>
  tracks.map((track, position) => {
    const named = track.title?.trim() || track.language?.trim();
    return {
      index: track.index ?? position,
      label: named || `Track ${position + 1}`,
    };
  });

/**
 * Which track the user is hearing.
 *
 * Their pick wins; otherwise the player's own `selected` flag; otherwise
 * `null`, meaning nobody told us and the UI should say "Default" rather than
 * highlight a row it has no way to confirm.
 */
export const resolveActiveAudioIndex = (
  tracks: AudioTrack[],
  pickedIndex: number | null,
): number | null =>
  pickedIndex ?? tracks.find((track) => track.selected)?.index ?? null;
