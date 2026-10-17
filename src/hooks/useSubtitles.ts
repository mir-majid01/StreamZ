import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import { VdrkSubtitleService } from '@/src/services/VdrkSubtitleService';
import { WyzieService, type WyzieSubtitle } from '@/src/services/WyzieService';
import type { LocalDownloadedSubtitle } from '@/src/services/DownloadService';
import {
  findCueAt,
  parseSubtitleText,
  type SubtitleCue,
} from '@/src/utils/subtitles';

export type SubtitleTrack = WyzieSubtitle | LocalDownloadedSubtitle;

interface UseSubtitlesArgs {
  tmdbId: number;
  season?: number;
  episode?: number;
  enabled?: boolean;
  /**
   * Whether to download + parse the selected track's `.srt`/`.vtt` text into
   * `cues` for `SubtitleOverlay` to render. Defaults to `true`. Callers that
   * hand the track's `url` straight to a native sidecar text track instead
   * (react-native-video's `source.textTracks`) can set this to `false` to
   * skip the extra network fetch — the track *search* above still needs to
   * run either way, since it's also how the sidecar list gets built.
   */
  loadCues?: boolean;
  /** ISO 639-1 code; auto-selects a matching track when tracks load. */
  defaultLanguage?: string;
  /**
   * When set (offline playback of a completed download), skip Wyzie entirely
   * and use these local tracks instead. Cue text is read from `localUri`.
   */
  localTracks?: LocalDownloadedSubtitle[];
  /**
   * Wyzie `format` query (default `srt`). Pass `vtt` for native sidecar mode
   * — iOS only supports WebVTT sidecars, and VTT is the most reliable MIME
   * on Android with react-native-video.
   */
  format?: 'srt' | 'vtt';
  /** Extractor sidecar tracks (Streamflix Videasy/Vidzee), shown above Wyzie. */
  extraTracks?: WyzieSubtitle[];
}

const MAX_TRACKS = 80;

/**
 * Default for `extraTracks`. A fresh `[]` literal in the parameter list is a new identity
 * every render, which is exactly what the memoized `tracks` below is trying to avoid.
 */
const NO_EXTRA_TRACKS: WyzieSubtitle[] = [];

const isLocalTrack = (
  track: SubtitleTrack,
): track is LocalDownloadedSubtitle => 'localUri' in track;

export const useSubtitles = ({
  tmdbId,
  season,
  episode,
  enabled = true,
  loadCues = true,
  defaultLanguage,
  localTracks,
  format = 'srt',
  extraTracks = NO_EXTRA_TRACKS,
}: UseSubtitlesArgs) => {
  const [remoteTracks, setRemoteTracks] = useState<WyzieSubtitle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingCues, setLoadingCues] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error`: that one means the list never arrived, this one means a track
  // was picked and its file could not be read or parsed. A player with an empty caption
  // area looks identical either way, which is why a failed download used to be invisible.
  const [cueError, setCueError] = useState<string | null>(null);
  // Once the user has interacted (including choosing "Off"), stop auto-selecting.
  const didAutoSelectRef = useRef(false);

  const useLocal = (localTracks?.length ?? 0) > 0;
  // Identity matters more than the array here: the auto-select effect below is keyed on
  // `tracks`, so rebuilding it on every parent render re-ran the effect every render.
  const tracks = useMemo<SubtitleTrack[]>(() => {
    if (useLocal) return localTracks as LocalDownloadedSubtitle[];
    return [...extraTracks, ...remoteTracks];
  }, [useLocal, localTracks, extraTracks, remoteTracks]);

  useEffect(() => {
    if (!enabled || !tmdbId || useLocal) {
      if (useLocal) {
        setRemoteTracks([]);
        setLoading(false);
        setError(null);
      }
      return;
    }
    let cancelled = false;
    setRemoteTracks([]);
    setLoading(true);
    setError(null);
    // Fetch across ALL languages (no `language` filter). Dedup and sort so the
    // default language sits at the top of the picker.
    Promise.allSettled([
      WyzieService.searchSubtitles({ tmdbId, season, episode, format }),
      VdrkSubtitleService.searchSubtitles({ tmdbId, season, episode }),
    ])
      .then(([wyzie, vdrk]) => {
        if (cancelled) return;
        const wyzieTracks = wyzie.status === 'fulfilled' ? wyzie.value : [];
        const vdrkTracks = vdrk.status === 'fulfilled' ? vdrk.value : [];
        if (wyzie.status === 'rejected' && vdrkTracks.length === 0) {
          setError(
            wyzie.reason instanceof Error
              ? wyzie.reason.message
              : 'Subtitle search failed',
          );
          setRemoteTracks([]);
          return;
        }
        const seen = new Set<string>();
        const unique: WyzieSubtitle[] = [];
        for (const r of [...vdrkTracks, ...wyzieTracks]) {
          const key = `${r.language}-${r.display}-${r.isHearingImpaired ? 'cc' : 'n'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(r);
          if (unique.length >= MAX_TRACKS) break;
        }
        const sorted = unique.sort((a, b) => {
          if (defaultLanguage) {
            const aDefault = a.language === defaultLanguage ? 0 : 1;
            const bDefault = b.language === defaultLanguage ? 0 : 1;
            if (aDefault !== bDefault) return aDefault - bDefault;
          }
          return a.display.localeCompare(b.display);
        });
        setRemoteTracks(sorted);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tmdbId, season, episode, enabled, defaultLanguage, useLocal, format]);

  // Auto-select the first track that matches the default language (once).
  // For offline local tracks, auto-select the first (only) bundled track.
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    if (!tracks.length) return;
    if (selectedId != null) return;
    if (useLocal) {
      didAutoSelectRef.current = true;
      setSelectedId(tracks[0].id);
      return;
    }
    if (!defaultLanguage) return;
    const match = tracks.find((t) => t.language === defaultLanguage);
    if (match) {
      didAutoSelectRef.current = true;
      setSelectedId(match.id);
    }
  }, [tracks, defaultLanguage, selectedId, useLocal]);

  // String key so parent re-renders that rebuild the `tracks` array don't
  // cancel an in-flight cue download when the selected URI is unchanged.
  const selectedSourceKey = useMemo(() => {
    if (!selectedId) return null;
    const track = tracks.find((t) => t.id === selectedId);
    if (!track) return null;
    return isLocalTrack(track)
      ? `local:${track.localUri}`
      : `remote:${track.url}`;
  }, [tracks, selectedId]);

  useEffect(() => {
    if (!loadCues || !selectedSourceKey) {
      setCues([]);
      setCueError(null);
      return;
    }
    const isLocal = selectedSourceKey.startsWith('local:');
    const uri = selectedSourceKey.slice(selectedSourceKey.indexOf(':') + 1);

    // Drop the previous track's cues before fetching. Without this the old
    // language stays on screen for the whole download, so switching from
    // English to Hindi shows English captions over Hindi audio first — and if
    // the new fetch fails, `catch` clears them only after that delay.
    setCues([]);
    setCueError(null);

    let cancelled = false;
    setLoadingCues(true);

    const load = async () => {
      try {
        const text = isLocal
          ? await new File(uri).text()
          : await WyzieService.fetchSubtitleText(uri);
        if (cancelled) return;
        const parsed = parseSubtitleText(text);
        // A file that arrived but yielded no cues is a different failure from one
        // that never arrived, and both look like "no subtitles" on screen.
        setCueError(
          parsed.length === 0 && text.trim().length > 0
            ? 'That file downloaded but contains no readable cues.'
            : null,
        );
        setCues(parsed);
      } catch (err) {
        if (cancelled) return;
        setCues([]);
        setCueError(err instanceof Error ? err.message : 'Subtitle download failed.');
      } finally {
        if (!cancelled) setLoadingCues(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [loadCues, selectedSourceKey]);

  const selectTrack = useCallback((id: string | null) => {
    // Any manual selection (including explicit "Off") disables auto-select.
    didAutoSelectRef.current = true;
    setSelectedId(id);
  }, []);

  const cueAt = useCallback(
    (time: number) => findCueAt(cues, time),
    [cues],
  );

  const selectedTrack = useMemo(
    () => tracks.find((t) => t.id === selectedId) ?? null,
    [tracks, selectedId],
  );

  return {
    tracks,
    selectedId,
    selectedTrack,
    selectTrack,
    cueAt,
    loading,
    loadingCues,
    error,
    cueError,
  };
};
