import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, RefreshCw, VideoOff } from 'lucide-react-native';
import { useKeepAwake } from 'expo-keep-awake';
import type { ReactVideoSource } from 'react-native-video';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import {
  Toast,
  ToastDescription,
  ToastTitle,
  useToast,
} from '@/components/ui/toast';
import { Focusable } from '@/src/components/Focusable';
import { PlayerCore } from '@/src/components/player/PlayerCore';
import { useImmersivePlayerChrome } from '@/src/components/player/useImmersivePlayerChrome';
import { ServerLoadingSideNav } from '@/src/components/player/ServerLoadingSideNav';
import {
  WebViewScraper,
  type ExtractedStream,
} from '@/src/components/player/WebViewScraper';
import { useServers } from '@/src/hooks/useServers';
import { useDownloads } from '@/src/hooks/useDownloads';
import { usePlayerDebugSettings } from '@/src/hooks/usePlayerDebugSettings';
import { TMDBService } from '@/src/services/TMDBService';
import { buildEmbedUrl } from '@/src/utils/streamUrl';
import { playbackHeadersFor } from '@/src/services/playbackHeaders';
import {
  StreamflixService,
  isStreamflixServer,
  type StreamflixSource,
  type StreamflixSubtitle,
} from '@/src/services/StreamflixService';
import {
  FLIXQUEST_SERVER_PREFIX,
  FlixQuestService,
  friendlyScraperError,
  isFlixQuestServer,
} from '@/src/services/FlixQuestService';
import {
  getReleaseDate,
  getTitle,
  isMovie,
  type Episode,
  type MediaItem,
} from '@/src/types';
import { resolveFirstAiredEpisode } from '@/src/hooks/useWatchNextRecommendation';
import {
  deriveStage,
  isBudgetFailure,
  withinBudget,
  type FailureReason,
} from '@/src/utils/sourceResolution';
import {
  formatScoreBreakdown,
  onDemandSourceType,
  rankSources,
  type RankedSource,
} from '@/src/utils/sourceRanking';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import type { RootStackScreenProps } from '@/src/navigation/types';
import { useWatchParty } from '@/src/hooks/useWatchParty';
import {
  PARTY_URI_MAX,
  isPartyStreamUri,
  partySourceKind,
  type PartyContent,
} from '@/src/party/protocol';
import {
  mediaItemFromPartyContent,
  partyContentFromItem,
} from '@/src/party/content';

/**
 * Wall-clock budget for one candidate's extraction. `StreamflixService` already
 * aborts each individual request at 15s, so this only fires when a request
 * hangs somewhere that fetch's own timeout cannot reach (a stalled body, a
 * wedged keep-alive). Sized above the three sequential calls the Videasy
 * extraction can make so a merely slow host is not cut off.
 */
const RESOLVE_CANDIDATE_BUDGET_MS = 60_000;

/**
 * Wall-clock budget for the *listing* call, which until now had none.
 *
 * `StreamflixService.listSources` is not one request: `listVidrock` issues one
 * request per returned server (`pickAtlasMp4`) after the movie/episode lookup,
 * each individually aborted at 15s by `streamflixFetch`, so a slow host with
 * eight entries can hold this screen for over two minutes while the user watches
 * a spinner. 30s is the point where that stops being worth waiting for: the
 * Vidrock lookup alone gets its full 15s, plus one more round trip's worth, and
 * the Videasy/Vidzee candidates — which need no network at all to be listed —
 * are no longer starved behind a wedged CDN. FlixQuest's own single call is
 * capped at 60s internally, so this app-level bound is deliberately the tighter
 * of the two: the screen's budget is what the user experiences.
 *
 * Per-candidate *extraction* keeps its own, separate budget above.
 */
const LIST_SOURCES_BUDGET_MS = 30_000;

/** Width of the developer-only `ServerLoadingSideNav` rail, so text can dodge it. */
const DEV_NAV_RAIL_WIDTH = 256;

/**
 * How long to wait after a URL is handed to the player for the player to prove
 * it started. A host that returns a URL but never delivers a playable stream
 * can leave the native player in `loading` forever without ever firing an
 * error, and nothing else would fail over. Deliberately generous: ExoPlayer's
 * own startup buffer is 2.5s, but a cold CDN can take seconds more.
 */
const PLAYBACK_STARTUP_BUDGET_MS = 25_000;

export const PlayerScreen = ({
  route,
  navigation,
}: RootStackScreenProps<'Player'>) => {
  const {
    item: routeItem,
    title: initialTitle,
    // `videoUrl` is kept on the route params for future pre-resolved-stream
    // callers, but the Player no longer uses it as a silent fallback when
    // scraping fails — we render an explicit empty state instead.
    subtitle: initialSubtitle,
    season: initialSeason,
    episode: initialEpisode,
    resumeFrom,
    localSourceId,
  } = route.params;
  const [item, setItem] = useState<MediaItem>(routeItem);

  // Hold a wake lock while the Player screen is mounted so the device won't
  // sleep during playback (or while paused/buffering). Released on unmount.
  useKeepAwake('flick-player');

  const { servers, activeServer, setActive } = useServers();
  const {
    jobs,
    getJob,
    getJobFor,
    prepareLocalPlayback,
    stopLocalPlayback,
  } = useDownloads();
  const { role, send, subscribe, leaveRoom, room, rtc } = useWatchParty();
  const roleRef = useRef(role);
  roleRef.current = role;
  // The call API belongs to the app-lifetime party provider, so the latest object is kept
  // in a ref and read from the unmount cleanup below rather than captured at mount.
  const rtcRef = useRef(rtc);
  rtcRef.current = rtc;
  const stayInRoomOnExitRef = useRef(true);
  // Player debug mode: when on, render the stream-resolving WebViewScraper
  // full-screen and interactive instead of invisible, so you can watch exactly
  // what the embed page is doing. Toggled from Settings > Playback
  // ("Resolver view"); off is the normal path.
  const { scraperDebugEnabled, smartPlayEnabled } = usePlayerDebugSettings();
  const toast = useToast();
  // The pre-playback screen is full-bleed landscape, so its centred block has to
  // be inset by the notch/cutout and dodge the back arrow — "centred" is not the
  // same as "readable" on a device with a pill.
  const insets = useSafeAreaInsets();
  const type: 'movie' | 'tv' = item.media_type === 'tv' ? 'tv' : 'movie';

  // Episode-switching state: lifted here so the drawer can drive re-scraping
  // via the WebViewScraper without recreating the player mid-playback.
  const [season, setSeason] = useState<number | undefined>(initialSeason);
  const [episode, setEpisode] = useState<number | undefined>(initialEpisode);
  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState<string | undefined>(initialSubtitle);
  const [source, setSource] = useState<ReactVideoSource | null>(null);
  /**
   * Set to `true` when the WebViewScraper gives up. Renders a "No video
   * available" UI instead of silently falling back to a sample URL.
   */
  const [noSource, setNoSource] = useState(false);
  const [waitingForHost, setWaitingForHost] = useState(
    () => role === 'guest' && Boolean(room?.browsing),
  );

  useEffect(() => {
    setItem(routeItem);
    setSeason(initialSeason);
    setEpisode(initialEpisode);
    setTitle(initialTitle);
    setSubtitle(initialSubtitle);
  }, [routeItem, initialSeason, initialEpisode, initialTitle, initialSubtitle]);
  /**
   * Debug mode only: set once a stream URL has actually been intercepted,
   * even though we deliberately don't hand off to `PlayerCore` for it (see
   * `onExtracted`). Just flips the status badge below so it's clear the page
   * is now the thing actually playing the video, not still searching.
   */
  const [debugStreamFound, setDebugStreamFound] = useState(false);
  // `resumeFrom` only applies to the initial episode; switches always start
  // from the beginning.
  const [effectiveResumeFrom, setEffectiveResumeFrom] = useState<
    number | undefined
  >(resumeFrom);
  const resolvedRef = useRef(false);
  /**
   * True only once the native player has reported a real load for the source it
   * was mounted with. A URL from a host is not playback, and this is what keeps
   * those two facts apart in the UI and in the startup watchdog below.
   */
  const [playbackConfirmed, setPlaybackConfirmed] = useState(false);
  /**
   * How the previous candidate gave up, so the retrying label can say which one
   * failed and why instead of implying nothing went wrong.
   */
  const [lastFailure, setLastFailure] = useState<{
    label: string | null;
    reason: FailureReason;
  } | null>(null);
  // Servers already tried (and failed) for the CURRENT target — reset
  // whenever the target itself changes (item/episode) or the user
  // explicitly picks a server, so a fresh failover cycle can run each time.
  // See `switchToServer`/`tryNextServer` below. State (not a ref) so
  // `ServerLoadingSideNav` re-renders with each server's up-to-date status.
  const [triedServerIds, setTriedServerIds] = useState<Set<string>>(
    new Set(),
  );

  // Best-effort IMDb id lookup for the current item — fills a playback
  // server's `{imdbId}` URL placeholder, if its pattern uses one. Swallow
  // errors; servers that don't need it are unaffected by a missing value.
  const [imdbId, setImdbId] = useState<string | null>(null);
  /**
   * Whether the lookup above has answered, one way or the other. The resolver
   * waits for this instead of re-running when the id arrives, so a title is
   * listed against the hosts once rather than twice with the first attempt
   * thrown away mid-flight.
   */
  const [imdbSettled, setImdbSettled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setImdbId(null);
    setImdbSettled(false);
    const request =
      type === 'tv'
        ? TMDBService.getTVExternalIds(item.id)
        : TMDBService.getMovieExternalIds(item.id);
    request
      .then((res) => {
        if (cancelled) return;
        setImdbId(res.imdb_id ?? null);
        setImdbSettled(true);
      })
      .catch(() => {
        if (cancelled) return;
        setImdbSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, type]);

  useImmersivePlayerChrome(navigation);

  const finish = useCallback((s: ReactVideoSource) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setSource(s);
  }, []);

  // Every source change is a fresh attempt the player has not proven yet —
  // whether it came from a first resolution, a failover, or a manual switch.
  // Resetting here covers all of those without touching each reset site.
  useEffect(() => {
    setPlaybackConfirmed(false);
  }, [source]);

  const publishHostSource = useCallback(
    (url: string, kind?: 'hls' | 'file', sourceId?: string) => {
      if (role !== 'host') return;
      // Only the scraped media URL — never the embed/page link.
      // Streamflix Vidrock URLs are sometimes extensionless (type from API).
      if (isStreamflixServer(activeServer) || isFlixQuestServer(activeServer)) {
        if (!/^https?:\/\//i.test(url)) return;
      } else if (!isPartyStreamUri(url)) {
        return;
      }
      const headers = playbackHeadersFor(activeServer);
      send({
        type: 'source',
        uri: url.slice(0, PARTY_URI_MAX),
        kind: kind ?? partySourceKind(url),
        referer: headers.Referer.slice(0, PARTY_URI_MAX),
        origin: headers.Origin.slice(0, PARTY_URI_MAX),
        ...(sourceId ? { sourceId: sourceId.slice(0, 80) } : {}),
        ...(isStreamflixServer(activeServer)
          ? {}
          : {
              embedUrl: buildEmbedUrl(activeServer, {
                type,
                tmdbId: item.id,
                imdbId,
                season,
                episode,
                title: getTitle(item),
              }).slice(0, PARTY_URI_MAX),
            }),
      });
    },
    [role, send, activeServer, type, item, imdbId, season, episode],
  );

  // Resolve a downloaded local copy for whatever we're currently trying to
  // play. Priority: explicit `localSourceId` from the caller (e.g. the
  // Downloads screen), otherwise best-effort lookup by the current item +
  // season/episode. This lets Home "Continue Watching", Detail Play, and
  // Downloads all seamlessly reuse a completed download.
  // Depend on `jobs` so subtitle sidecars written after video completion
  // re-render into PlayerCore without remounting.
  const localJob = useMemo(() => {
    if (localSourceId) return getJob(localSourceId);
    return getJobFor(item, season, episode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jobs triggers refresh
  }, [localSourceId, getJob, getJobFor, item, season, episode, jobs]);

  const playingDownloaded = localJob?.status === 'completed';

  const localSubtitles = playingDownloaded ? localJob.subtitles : undefined;

  // Track which episode key we've already toasted about, so switching
  // between episodes shows the "data saving" toast at most once each.
  const toastedKeyRef = useRef<string | null>(null);

  // Playing back a downloaded copy: short-circuit the scraper entirely and
  // feed a local source into react-native-video. iOS HLS goes through a
  // loopback HTTP server (AVPlayer will not play file:// playlists); Android
  // uses the on-disk file:// URI. Depend on job id + completed status only
  // — not the full `jobs` snapshot — so a late subtitle sidecar write does
  // not tear down the loopback server.
  //
  // The `resolvedRef` guard matters: if the user was ALREADY streaming and a
  // background download for this same episode finished mid-playback, we
  // don't want to restart or spam a toast — we just leave the stream alone.
  useEffect(() => {
    if (waitingForHost) return;
    if (!playingDownloaded || !localJob?.id) {
      void stopLocalPlayback();
      return;
    }
    if (resolvedRef.current) return;
    const jobId = localJob.id;
    let cancelled = false;
    void prepareLocalPlayback(jobId).then((src) => {
      if (cancelled) return;
      if (!src) {
        setNoSource(true);
        return;
      }
      finish(src);

      const key = `${item.id}-${season ?? 'm'}-${episode ?? 'm'}`;
      if (toastedKeyRef.current === key) return;
      toastedKeyRef.current = key;
      toast.show({
        placement: 'top',
        duration: 3500,
        render: ({ id }) => (
          <Toast nativeID={id} action="info" variant="solid">
            <ToastTitle>Playing downloaded copy</ToastTitle>
            <ToastDescription>
              Using your offline download to save data.
            </ToastDescription>
          </Toast>
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    waitingForHost,
    playingDownloaded,
    localJob?.id,
    prepareLocalPlayback,
    stopLocalPlayback,
    finish,
    item.id,
    season,
    episode,
    toast,
  ]);

  useEffect(() => {
    return () => {
      void stopLocalPlayback();
    };
  }, [stopLocalPlayback]);

  const onExtracted = useCallback(
    ({ videoUrl: url }: ExtractedStream) => {
      // Debug mode: a stream request was intercepted, confirming the page
      // itself is now actually playing the video — but deliberately don't
      // hand off to the native `PlayerCore`. Some streams that fail (DRM,
      // header/cookie quirks, decoder support) in react-native-video play
      // back fine directly inside the browser context that resolved them,
      // so staying on the WebView here doubles as a way to actually watch
      // those.
      if (scraperDebugEnabled) {
        setDebugStreamFound(true);
        return;
      }
      finish({
        uri: url,
        // Explicit MIME hint for HLS; react-native-video otherwise infers
        // from the URL/response, matching expo-video's 'auto' for anything
        // else. Persistent caching is handled separately, per-platform, via
        // `source.bufferConfig.cacheSizeMB` inside `PlayerCore` (Android
        // only — iOS/AVFoundation never cached HLS anyway).
        type: url.includes('.m3u8') ? 'm3u8' : undefined,
        // Default the request origin to the selected server, which many
        // stream hosts require (403 otherwise).
        headers: playbackHeadersFor(activeServer),
      });
      publishHostSource(url);
    },
    [finish, activeServer, scraperDebugEnabled, publishHostSource],
  );

  // Shared by manual server switching (Settings > Server, in-player) and
  // automatic failover below: resets resolution state and points `useServers`
  // at a different server, re-arming `WebViewScraper` to resolve against it.
  // `resumeFromSeconds` re-seeds `effectiveResumeFrom` so a switch resumes
  // near wherever playback was, instead of restarting from 0.
  const switchToServer = useCallback(
    (id: string, resumeFromSeconds: number) => {
      setActive(id);
      triedStreamflixIdsRef.current = new Set();
      setTriedStreamflixIds(new Set());
      setTryingStreamflixSource(null);
      setPreferredStreamflixSourceId(null);
      setStreamflixSources([]);
      setSourceRanking([]);
      setActiveStreamflixSourceId(null);
      setExtractorSubtitles([]);
      resolvedRef.current = false;
      setSource(null);
      setNoSource(false);
      setDebugStreamFound(false);
      setEffectiveResumeFrom(resumeFromSeconds);
    },
    [setActive],
  );

  // User-initiated switch (in-player Settings > Server, or Server Settings
  // itself) — always starts a fresh failover cycle from the chosen server.
  const handleSelectServer = useCallback(
    (id: string, resumeFromSeconds: number) => {
      if (id === activeServer.id) return;
      setTriedServerIds(new Set());
      setLastFailure(null);
      switchToServer(id, resumeFromSeconds);
    },
    [activeServer.id, switchToServer],
  );

  // Failure-driven: mark the current server as tried and move on to the
  // first server in the list not yet tried this cycle. Once every server
  // has failed, fall through to the "No video available" empty state.
  //
  // With Smart Play off this stops at the server that failed instead of
  // quietly moving on, so the user's chosen server is never swapped out from
  // under them — they can still switch by hand, and the empty state explains
  // that only this server was tried.
  const tryNextServer = useCallback(
    (resumeFromSeconds: number) => {
      if (!smartPlayEnabled) {
        setNoSource(true);
        return;
      }
      const updated = new Set(triedServerIds).add(activeServer.id);
      const next = servers.find((s) => !updated.has(s.id));
      setTriedServerIds(updated);
      if (!next) {
        setNoSource(true);
        return;
      }
      switchToServer(next.id, resumeFromSeconds);
    },
    [
      smartPlayEnabled,
      servers,
      activeServer.id,
      triedServerIds,
      switchToServer,
    ],
  );

  // On scrape failure/timeout, try the next configured server before giving
  // up — no sample-URL fallback either way. Callers who want a specific
  // pre-resolved stream should push `Player` with a `localSourceId` (for
  // downloads) instead.
  const onScrapeError = useCallback(() => {
    // Nothing has played yet at the resolution stage — carry forward
    // whatever resume position was already queued (continue-watching's
    // original position, or one queued by a prior switch this cycle)
    // instead of clobbering it with 0.
    tryNextServer(effectiveResumeFrom ?? 0);
  }, [tryNextServer, effectiveResumeFrom]);

  const usingStreamflix = isStreamflixServer(activeServer);
  const usingFlixquest = isFlixQuestServer(activeServer);
  const usingRestResolver = usingStreamflix || usingFlixquest;
  const [streamflixSources, setStreamflixSources] = useState<StreamflixSource[]>(
    [],
  );
  /**
   * The scorer's per-candidate breakdown for the current listing, kept only so
   * the developer-only rail can say *why* a source sits where it does. Nothing
   * on the normal path reads it.
   */
  const [sourceRanking, setSourceRanking] = useState<
    RankedSource<StreamflixSource>[]
  >([]);
  const [activeStreamflixSourceId, setActiveStreamflixSourceId] = useState<
    string | null
  >(null);
  const [preferredStreamflixSourceId, setPreferredStreamflixSourceId] =
    useState<string | null>(null);
  const [extractorSubtitles, setExtractorSubtitles] = useState<
    StreamflixSubtitle[]
  >([]);
  const triedStreamflixIdsRef = useRef<Set<string>>(new Set());
  const [triedStreamflixIds, setTriedStreamflixIds] = useState<Set<string>>(
    new Set(),
  );
  const [tryingStreamflixSource, setTryingStreamflixSource] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const resetTriedStreamflix = useCallback(() => {
    triedStreamflixIdsRef.current = new Set();
    setTriedStreamflixIds(new Set());
    // A new cycle (chosen source, new episode, new target) starts with a clean
    // history; only automatic failover keeps the previous reason around to name.
    setLastFailure(null);
    setTryingStreamflixSource(null);
  }, []);

  const markTriedStreamflix = useCallback((id: string) => {
    triedStreamflixIdsRef.current.add(id);
    setTriedStreamflixIds(new Set(triedStreamflixIdsRef.current));
  }, []);

  const year = (getReleaseDate(item) || '').split('-')[0];

  const playResolvedSource = useCallback(
    (resolved: StreamflixSource) => {
      finish({
        uri: resolved.uri,
        // The player-facing hint comes from the URL, not from `resolved.kind`.
        // `kind` is the `'hls' | 'file'` union that `DownloadService` and the
        // party protocol consume, and both FlixQuest (`kindOf`) and Vidrock fold
        // DASH into `'hls'` — so a `.mpd` filed as `'hls'` used to be handed to
        // the HLS parser and failed as a malformed playlist. Same reasoning the
        // live path now uses; progressive files still get no hint at all, so the
        // player infers them.
        type: onDemandSourceType(resolved.uri),
        headers: resolved.headers ?? playbackHeadersFor(activeServer),
      });
      setActiveStreamflixSourceId(resolved.id);
      setExtractorSubtitles(resolved.subtitles ?? []);
      publishHostSource(resolved.uri, resolved.kind, resolved.id);
    },
    [activeServer, finish, publishHostSource],
  );

  // Late-joining web clients read the last source off the room; re-publish
  // when PlayerCore is already up (source resolved before the party, or
  // remount) so the companion page is not stuck on "waiting".
  useEffect(() => {
    const uri =
      typeof source === 'object' && source && typeof source.uri === 'string'
        ? source.uri
        : null;
    if (!uri) return;
    publishHostSource(uri, undefined, activeStreamflixSourceId ?? undefined);
  }, [source, publishHostSource, activeStreamflixSourceId]);

  // Latest-value refs for the three callbacks the resolver calls. They are
  // deliberately *not* dependencies of the effect below. Their identities change
  // with failover bookkeeping — `onScrapeError` → `tryNextServer` →
  // `triedServerIds` state, `playResolvedSource` → `publishHostSource` — and
  // because the effect guards on "nothing resolved yet", every such change mid
  // attempt cancelled the in-flight listing and re-ran `listSources` from zero.
  // Reading the newest callback at call time is the smaller correct change: same
  // behaviour, no restart. Stabilising the callbacks instead would mean taking
  // `triedServerIds` (state the developer rail renders) out of `tryNextServer`'s
  // inputs, which is a larger change to failover than this bug needs.
  const playResolvedSourceRef = useRef(playResolvedSource);
  playResolvedSourceRef.current = playResolvedSource;
  const onScrapeErrorRef = useRef(onScrapeError);
  onScrapeErrorRef.current = onScrapeError;
  const markTriedStreamflixRef = useRef(markTriedStreamflix);
  markTriedStreamflixRef.current = markTriedStreamflix;

  useEffect(() => {
    if (playingDownloaded) return;
    if (resolvedRef.current || source || noSource || waitingForHost) return;
    if (!usingRestResolver) return;
    // Videasy folds the IMDb id into its search, so starting before the lookup
    // answers lists sources with a weaker key and then discards that attempt the
    // moment the id lands. FlixQuest never uses it and starts immediately.
    if (usingStreamflix && !imdbSettled) return;
    let cancelled = false;
    const providerTag = usingFlixquest ? '[FlixQuest]' : '[Streamflix]';
    const run = async () => {
      try {
        // Bounded end to end: a listing that cannot answer inside
        // `LIST_SOURCES_BUDGET_MS` is failed over like any other failure,
        // instead of leaving this screen on a spinner indefinitely.
        const listed = await withinBudget(
          () =>
            usingFlixquest
              ? FlixQuestService.listSources({
                  providerId:
                    activeServer.scraperProviderId ||
                    activeServer.id.replace(FLIXQUEST_SERVER_PREFIX, ''),
                  tmdbId: item.id,
                  mediaType: type,
                  season,
                  episode,
                })
              : StreamflixService.listSources({
                  tmdbId: item.id,
                  mediaType: type,
                  season,
                  episode,
                  title: getTitle(item),
                  year,
                  imdbId,
                }),
          LIST_SOURCES_BUDGET_MS,
        );
        if (cancelled || resolvedRef.current) return;
        // Deterministic best-first order, from `rankSources`: same candidates
        // always produce the same order, whatever order the host returned them
        // in. The stored list *is* the ranked list, so in-player failover and the
        // source picker walk candidates in the same order the resolver does.
        const ranked = rankSources(listed, { platform: Platform.OS });
        setSourceRanking(ranked);
        const ordered = ranked.map((entry) => entry.source);
        setStreamflixSources(ordered);
        if (!listed.length) {
          onScrapeErrorRef.current();
          return;
        }
        // An explicit user pick wins outright — ranking never overrides a choice
        // the user actually made. Without one, the top-ranked candidate leads;
        // with Smart Play off, that one candidate is the whole attempt.
        const picked = preferredStreamflixSourceId
          ? ordered.find((s) => s.id === preferredStreamflixSourceId)
          : undefined;
        const lead = picked ?? ordered[0];
        const attempted = !smartPlayEnabled
          ? lead
            ? [lead]
            : []
          : picked
            ? [picked, ...ordered.filter((s) => s.id !== picked.id)]
            : ordered;
        // Then the failover bookkeeping, unchanged: a candidate that already
        // yielded nothing for this target does not get a second turn.
        const order = attempted.filter(
          (s) => !triedStreamflixIdsRef.current.has(s.id),
        );
        for (const candidate of order) {
          if (cancelled || resolvedRef.current) return;
          setTryingStreamflixSource({ id: candidate.id, name: candidate.name });
          let resolved: StreamflixSource | null;
          try {
            resolved = usingFlixquest
              ? candidate
              : await withinBudget(
                  () => StreamflixService.resolveSource(candidate),
                  RESOLVE_CANDIDATE_BUDGET_MS,
                );
          } catch (error) {
            if (cancelled || resolvedRef.current) return;
            // Anything other than running out of budget keeps failing over at
            // the server level, exactly as before.
            if (!isBudgetFailure(error)) throw error;
            // One wedged host must not end the whole attempt: skip it and give
            // the next candidate its turn. The name is recorded for the developer
            // rail only — no user-facing copy repeats a provider name.
            // eslint-disable-next-line no-console
            console.log(
              providerTag,
              'player: budget exceeded by',
              candidate.name,
            );
            setLastFailure({ label: candidate.name, reason: 'timed_out' });
            markTriedStreamflixRef.current(candidate.id);
            continue;
          }
          if (cancelled || resolvedRef.current) return;
          if (resolved?.uri) {
            setTryingStreamflixSource(null);
            playResolvedSourceRef.current(resolved);
            return;
          }
          markTriedStreamflixRef.current(candidate.id);
        }
        onScrapeErrorRef.current();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log(providerTag, 'player: error', friendlyScraperError(error));
        if (isBudgetFailure(error)) {
          // The listing itself ran out of budget. Recorded without a label:
          // there is no single candidate to blame, and naming the provider here
          // is exactly what this screen must stop doing.
          setLastFailure({ label: null, reason: 'timed_out' });
        }
        if (!cancelled && !resolvedRef.current) onScrapeErrorRef.current();
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    playingDownloaded,
    source,
    noSource,
    waitingForHost,
    smartPlayEnabled,
    usingRestResolver,
    usingStreamflix,
    usingFlixquest,
    imdbSettled,
    activeServer,
    item,
    type,
    season,
    episode,
    year,
    imdbId,
    preferredStreamflixSourceId,
  ]);

  const handleSelectStreamflixSource = useCallback(
    (id: string, resumeFromSeconds: number, opts?: { failover?: boolean }) => {
      if (id === activeStreamflixSourceId) return;
      if (!opts?.failover) resetTriedStreamflix();
      setPreferredStreamflixSourceId(id);
      resolvedRef.current = false;
      setSource(null);
      setNoSource(false);
      setEffectiveResumeFrom(resumeFromSeconds);
    },
    [activeStreamflixSourceId, resetTriedStreamflix],
  );

  // A stream that DID resolve but then failed to actually play (403,
  // decoder/DRM issue, etc.) — reported by `PlayerCore`'s native `<Video>`
  // error handler. Also fails over, preserving how far playback got.
  const handlePlaybackFailed = useCallback(
    (resumeFromSeconds: number, reason: FailureReason = 'error') => {
      const failing = streamflixSources.find(
        (s) => s.id === activeStreamflixSourceId,
      );
      setLastFailure({ label: failing?.name ?? null, reason });
      if (
        smartPlayEnabled &&
        usingRestResolver &&
        activeStreamflixSourceId
      ) {
        markTriedStreamflix(activeStreamflixSourceId);
        const next = streamflixSources.find(
          (s) => !triedStreamflixIdsRef.current.has(s.id),
        );
        if (next) {
          handleSelectStreamflixSource(next.id, resumeFromSeconds, {
            failover: true,
          });
          return;
        }
      }
      tryNextServer(resumeFromSeconds);
    },
    [
      smartPlayEnabled,
      usingRestResolver,
      activeStreamflixSourceId,
      streamflixSources,
      handleSelectStreamflixSource,
      tryNextServer,
      markTriedStreamflix,
    ],
  );

  const handlePlaybackConfirmed = useCallback(() => {
    setPlaybackConfirmed(true);
    setLastFailure(null);
  }, []);

  /**
   * What can honestly be claimed about the current attempt. `playing` requires a
   * player event, never just a URL, and `failed` is checked first so a source
   * left over from an earlier attempt can't read as live.
   */
  const stage = useMemo(
    () =>
      deriveStage({
        failed: noSource,
        hasSource: source != null,
        confirmed: playbackConfirmed,
        resolving: tryingStreamflixSource != null,
        candidatesPending: streamflixSources.length > 0,
      }),
    [
      noSource,
      source,
      playbackConfirmed,
      tryingStreamflixSource,
      streamflixSources.length,
    ],
  );

  // A host can hand over a URL and then stall without the native player ever
  // reporting an error — ExoPlayer simply sits in `loading`. Nothing else would
  // ever leave that state, so the attempt gets a bounded window to prove it
  // started before it is written off as timed out and failed over.
  useEffect(() => {
    if (
      !source ||
      playingDownloaded ||
      waitingForHost ||
      stage === 'playing'
    ) {
      return;
    }
    const timer = setTimeout(() => {
      handlePlaybackFailed(effectiveResumeFrom ?? 0, 'timed_out');
    }, PLAYBACK_STARTUP_BUDGET_MS);
    return () => clearTimeout(timer);
  }, [
    source,
    stage,
    playingDownloaded,
    waitingForHost,
    effectiveResumeFrom,
    handlePlaybackFailed,
  ]);

  /**
   * The secondary line on the pre-playback screen.
   *
   * It describes progress, not provenance. The old version named the candidate
   * the resolver was on ("Trying Nflix (Vidzee)…") and the server being failed
   * over to, which put provider names in front of every user on the screen that
   * was supposed to look like the app simply playing something. Names are still
   * recorded in `lastFailure` / `tryingStreamflixSource` for the developer-only
   * rail; they are just no longer what this line says.
   */
  const progressLine = useMemo(() => {
    if (lastFailure) {
      const why =
        lastFailure.reason === 'timed_out' ? 'timed out' : 'did not start';
      return `The last attempt ${why} — trying another source…`;
    }
    if (stage === 'resolving') return 'Opening a source…';
    if (streamflixSources.length > 0) {
      return `Found ${streamflixSources.length} source${
        streamflixSources.length === 1 ? '' : 's'
      } — choosing the best match…`;
    }
    if (triedServerIds.size > 0) return 'Trying your next server…';
    return 'Looking for something that plays…';
  }, [lastFailure, stage, streamflixSources.length, triedServerIds.size]);

  /**
   * Per-candidate "why is it in this order" strings, read only by the
   * developer-only rail. Built from the scorer's breakdown so a developer can see
   * the signals behind a pick without adding a second, drifting copy of the rules.
   */
  const rankingDetailById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of sourceRanking) {
      map.set(entry.source.id, formatScoreBreakdown(entry.score));
    }
    return map;
  }, [sourceRanking]);

  /**
   * Retry from a clean slate after every candidate and server gave up. Without
   * this the failure screen's only exit was Back, and the rule for this flow is
   * "a clear error with a retry", not an apology the user has to leave.
   */
  const handleRetry = useCallback(() => {
    setTriedServerIds(new Set());
    resetTriedStreamflix();
    setPreferredStreamflixSourceId(null);
    setStreamflixSources([]);
    setSourceRanking([]);
    setActiveStreamflixSourceId(null);
    setExtractorSubtitles([]);
    setLastFailure(null);
    resolvedRef.current = false;
    setSource(null);
    setNoSource(false);
    setDebugStreamFound(false);
  }, [resetTriedStreamflix]);

  // Switch to a different episode without recreating the whole player screen:
  // reset the resolved source so `WebViewScraper` re-runs with new params, and
  // remount `PlayerCore` (via key on season/episode) once the new source lands.
  const handleSelectEpisode = useCallback(
    (nextSeason: number, ep: Episode) => {
      const nextEpisode = ep.episode_number;
      if (season === nextSeason && episode === nextEpisode) return;
      setTriedServerIds(new Set());
      resetTriedStreamflix();
      setPreferredStreamflixSourceId(null);
      setStreamflixSources([]);
      setSourceRanking([]);
      setActiveStreamflixSourceId(null);
      setExtractorSubtitles([]);
      resolvedRef.current = false;
      setSource(null);
      setNoSource(false);
      setDebugStreamFound(false);
      setEffectiveResumeFrom(undefined);
      setSeason(nextSeason);
      setEpisode(nextEpisode);
      setTitle(`${getTitle(item)} — ${ep.name}`);
      setSubtitle(`S${nextSeason} E${nextEpisode}`);
      if (role === 'host') {
        send({ type: 'episode', season: nextSeason, episode: nextEpisode });
      }
    },
    [item, season, episode, role, send, resetTriedStreamflix],
  );

  const applyPartyEpisode = useCallback(
    (nextSeason: number, nextEpisode: number) => {
      if (season === nextSeason && episode === nextEpisode) return;
      setTriedServerIds(new Set());
      resetTriedStreamflix();
      setPreferredStreamflixSourceId(null);
      setStreamflixSources([]);
      setSourceRanking([]);
      setActiveStreamflixSourceId(null);
      setExtractorSubtitles([]);
      resolvedRef.current = false;
      setSource(null);
      setNoSource(false);
      setDebugStreamFound(false);
      setEffectiveResumeFrom(undefined);
      setSeason(nextSeason);
      setEpisode(nextEpisode);
      setTitle(`${getTitle(item)} — S${nextSeason} E${nextEpisode}`);
      setSubtitle(`S${nextSeason} E${nextEpisode}`);
    },
    [item, season, episode, resetTriedStreamflix],
  );

  const resetPlaybackForParty = useCallback(() => {
    setTriedServerIds(new Set());
    resetTriedStreamflix();
    setPreferredStreamflixSourceId(null);
    setStreamflixSources([]);
    setSourceRanking([]);
    setActiveStreamflixSourceId(null);
    setExtractorSubtitles([]);
    resolvedRef.current = false;
    setSource(null);
    setNoSource(false);
    setDebugStreamFound(false);
    setEffectiveResumeFrom(undefined);
  }, [resetTriedStreamflix]);

  const applyPartyContent = useCallback(
    async (content: PartyContent) => {
      setWaitingForHost(false);
      try {
        const next = await mediaItemFromPartyContent(content);
        setItem(next);
        setSeason(content.season);
        setEpisode(content.episode);
        setTitle(
          content.season != null && content.episode != null
            ? `${getTitle(next)} — S${content.season} E${content.episode}`
            : getTitle(next),
        );
        setSubtitle(
          content.season != null && content.episode != null
            ? `S${content.season} E${content.episode}`
            : undefined,
        );
        resetPlaybackForParty();
      } catch {
        resetPlaybackForParty();
      }
    },
    [resetPlaybackForParty],
  );

  useEffect(() => {
    if (role !== 'host') return;
    send({
      type: 'content',
      content: partyContentFromItem(item, season, episode, imdbId),
    });
    // Title identity only — episode switches use the episode message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, item.id, item.media_type]);

  useEffect(() => {
    return subscribe((msg) => {
      if (role === 'guest' && msg.type === 'episode') {
        applyPartyEpisode(msg.season, msg.episode);
      }
      if (role === 'guest' && msg.type === 'browse') {
        setWaitingForHost(true);
        resetPlaybackForParty();
      }
      if (role === 'guest' && msg.type === 'content') {
        void applyPartyContent(msg.content);
      }
      if (msg.type === 'ended' && role) {
        stayInRoomOnExitRef.current = false;
        navigation.goBack();
      }
    });
  }, [
    subscribe,
    role,
    applyPartyEpisode,
    applyPartyContent,
    resetPlaybackForParty,
    navigation,
  ]);

  useEffect(() => {
    return () => {
      // The call UI unmounts with this screen, so its camera, microphone and peer
      // connections have to go with it; a host staying in the room keeps the room, not an
      // open capture. `leaveCall` is already the app's idempotent teardown — it does
      // nothing when no call was joined.
      rtcRef.current.leaveCall();
      if (!stayInRoomOnExitRef.current) return;
      if (roleRef.current === 'host') {
        send({ type: 'browse' });
        return;
      }
      if (roleRef.current === 'guest') leaveRoom();
    };
    // Host stays in the room; guests leave. Role is read from a ref so this
    // only runs on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLeaveParty = useCallback(() => {
    stayInRoomOnExitRef.current = false;
    leaveRoom();
    navigation.goBack();
  }, [leaveRoom, navigation]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  /**
   * Identity of the currently mounted Player. Bumped on mount, invalidated on
   * teardown, so anything that awaited the network on this instance's behalf can
   * tell whether the screen it was going to navigate is still the one on screen.
   */
  const resolutionEpochRef = useRef(0);
  useEffect(() => {
    const epoch = resolutionEpochRef.current + 1;
    resolutionEpochRef.current = epoch;
    return () => {
      if (resolutionEpochRef.current === epoch) resolutionEpochRef.current = 0;
    };
  }, []);

  const handlePlayRecommendation = useCallback(
    async (next: MediaItem) => {
      if (isMovie(next)) {
        navigation.replace('Player', {
          item: next,
          title: getTitle(next),
        });
        return;
      }
      // Captured before the network hop: `resolveFirstAiredEpisode` is a TMDB
      // lookup with no bound of its own, and until now whatever it answered with
      // called `navigation.replace` unconditionally — so a recommendation tapped
      // moments ago could pull the user into a title they had already left, or
      // replace a screen that had since become someone else's. Both the epoch
      // (this instance is gone) and focus (the user went elsewhere in the stack)
      // have to still say "this Player is the thing on screen" before navigating.
      const epoch = resolutionEpochRef.current;
      try {
        const first = await resolveFirstAiredEpisode(next);
        if (!first) return;
        if (epoch !== resolutionEpochRef.current || !navigation.isFocused()) {
          // eslint-disable-next-line no-console
          console.log('[Player]', 'stale recommendation dropped');
          return;
        }
        navigation.replace('Player', {
          item: next,
          title: `${getTitle(next)} — ${first.episode.name}`,
          season: first.season,
          episode: first.episode.episode_number,
          subtitle: `S${first.season} E${first.episode.episode_number}`,
        });
      } catch {
        // Leave the current player if we can't resolve an aired episode.
      }
    },
    [navigation],
  );

  if (source) {
    return (
      <PlayerCore
        // Server id is included so a switch (manual or automatic failover)
        // always mounts a fresh `<Video>` against the newly-resolved source
        // — `source` already transits through `null` on every switch (see
        // `switchToServer`), but the explicit id keeps this key legible.
        key={`${type === 'tv' ? `${season}-${episode}` : 'movie'}-${activeServer.id}-${activeStreamflixSourceId ?? ''}`}
        source={source}
        title={title}
        subtitle={subtitle}
        item={item}
        season={season}
        episode={episode}
        imdbId={imdbId}
        resumeFrom={effectiveResumeFrom}
        onBack={handleBack}
        onLeaveParty={handleLeaveParty}
        onSelectEpisode={
          type === 'tv' && role !== 'guest' ? handleSelectEpisode : undefined
        }
        onSelectServer={playingDownloaded ? undefined : handleSelectServer}
        streamflixSources={usingRestResolver ? streamflixSources : []}
        activeStreamflixSourceId={activeStreamflixSourceId}
        onSelectStreamflixSource={
          playingDownloaded || !usingRestResolver
            ? undefined
            : handleSelectStreamflixSource
        }
        extractorSubtitles={extractorSubtitles}
        onPlaybackFailed={playingDownloaded ? undefined : handlePlaybackFailed}
        onPlaybackConfirmed={handlePlaybackConfirmed}
        localSubtitles={localSubtitles}
        isLocalDownload={playingDownloaded}
        onPlayRecommendation={handlePlayRecommendation}
      />
    );
  }

  // Scrape (or playback) failed on every configured server. Instead of
  // silently loading a sample video, let the user know nothing is playable
  // and give them a way back to the previous screen.
  if (waitingForHost) {
    return (
      <Box className="flex-1 bg-black">
        <StatusBar hidden />
        <Center className="flex-1 px-8">
          <Spinner size="large" color="#E50914" />
          <Text size="lg" bold className="mt-4 text-center text-foreground">
            Host is picking something else…
          </Text>
          <Text size="sm" className="mt-2 text-center text-muted-foreground">
            Stay in the room. Playback starts when they choose a title.
          </Text>
        </Center>
        <Pressable
          onPress={handleLeaveParty}
          hitSlop={16}
          style={{ position: 'absolute', top: 24, left: 16, zIndex: 10 }}
        >
          <Icon as={ArrowLeft} size="xl" className="text-foreground" />
        </Pressable>
      </Box>
    );
  }

  if (noSource) {
    return (
      <Box className="flex-1 bg-black">
        <StatusBar hidden />
        <Center
          className="flex-1"
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            paddingLeft: insets.left + 72,
            paddingRight: insets.right + 16,
          }}
        >
          <Icon
            as={VideoOff}
            size="xl"
            className="mb-4 text-muted-foreground"
          />
          <Text size="lg" bold className="text-center text-foreground">
            No video available
          </Text>
          <Text size="sm" className="mt-2 text-center text-muted-foreground">
            {!smartPlayEnabled
              ? "We couldn't play this from the server you chose. Smart Play is off, so nothing else was tried — switch server in Settings, or turn Smart Play on."
              : lastFailure
                ? 'Some sources were found, but none of them started playing.'
                : servers.length > 1
                  ? "We couldn't find a playable stream from any configured server."
                  : "We couldn't find a playable stream from the current server. Try a different server from Settings."}
          </Text>
          {/* A failure this screen cannot recover from on its own still has to
              offer a retry, not just a way out — otherwise the only answer to
              "everything failed" is to leave and tap Play again. */}
          <Focusable
            onPress={handleRetry}
            hasTVPreferredFocus
            className="mt-6 rounded-full border border-border bg-card/95 px-5 py-3"
            focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
          >
            <HStack space="xs" className="items-center">
              <Icon as={RefreshCw} size="sm" className="text-foreground" />
              <Text size="sm" className="text-foreground">
                Try again
              </Text>
            </HStack>
          </Focusable>
        </Center>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={16}
          style={{ position: 'absolute', top: 24, left: 16, zIndex: 10 }}
        >
          <Icon as={ArrowLeft} size="xl" className="text-foreground" />
        </Pressable>
      </Box>
    );
  }

  // The provider/source rail is developer diagnostics: it only mounts when the
  // resolver debug switch is explicitly on in Settings > Playback. Normal use
  // gets the clean full-screen state below, where no provider name can appear.
  const devRailVisible = scraperDebugEnabled && !playingDownloaded;

  return (
    <Box className="flex-1 bg-black">
      <StatusBar hidden />
      {!playingDownloaded && !usingRestResolver && !waitingForHost && (
        <WebViewScraper
          server={activeServer}
          tmdbId={item.id}
          imdbId={imdbId}
          type={type}
          season={season}
          episode={episode}
          // Use the raw item title (not the episode-suffixed display `title`
          // state) so servers with a `{slug}` in their URL pattern always
          // slugify the show/movie name, not "Show — Episode Name".
          title={getTitle(item)}
          onDataExtracted={onExtracted}
          onError={onScrapeError}
          debug={scraperDebugEnabled}
          muted={!scraperDebugEnabled}
          autoTap={!scraperDebugEnabled}
          timeoutSeconds={activeServer.scraperTimeoutSeconds}
        />
      )}
      {scraperDebugEnabled && !usingRestResolver ? (
        // Debug: keep the WebView visible/interactive — once a stream is
        // found we deliberately keep showing it (see `onExtracted`) instead
        // of switching to the native player, so the page keeps playing the
        // video itself. Just a small status badge on top. Debug-only, so this
        // one badge is allowed to name the server it is waiting on.
        <Center
          className="absolute bottom-6 self-center rounded-full bg-black/80 px-4 py-2"
          pointerEvents="none"
        >
          <Text size="xs" className="text-muted-foreground">
            {debugStreamFound
              ? 'Stream found — playing in WebView (debug)'
              : `Finding stream… (debug, no timeout)${triedServerIds.size ? ` — trying ${activeServer.name}` : ''}`}
          </Text>
        </Center>
      ) : (
        <Center
          className="flex-1"
          style={{
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 16,
            // Clear the back arrow on the left, and the diagnostics rail on the
            // right when it is up: "centred" only reads as centred inside the
            // area the user can actually see.
            paddingLeft: insets.left + 72,
            paddingRight:
              insets.right + (devRailVisible ? DEV_NAV_RAIL_WIDTH + 16 : 16),
          }}
        >
          <Spinner size="large" color="#E50914" />
          <Text size="lg" bold className="mt-4 text-center text-foreground">
            Preparing playback…
          </Text>
          <Text size="sm" className="mt-2 text-center text-muted-foreground">
            {progressLine}
          </Text>
        </Center>
      )}
      {devRailVisible && (
        <ServerLoadingSideNav
          servers={servers}
          activeServerId={activeServer.id}
          triedServerIds={triedServerIds}
          onSelectServer={(id) =>
            handleSelectServer(id, effectiveResumeFrom ?? 0)
          }
          streamflixSources={
            usingRestResolver
              ? streamflixSources.map((s) => ({
                  id: s.id,
                  name: s.name,
                  language: s.language,
                  detail: rankingDetailById.get(s.id),
                }))
              : []
          }
          tryingStreamflixSourceId={tryingStreamflixSource?.id ?? null}
          triedStreamflixIds={triedStreamflixIds}
          onSelectStreamflixSource={
            usingRestResolver
              ? (id) =>
                  handleSelectStreamflixSource(id, effectiveResumeFrom ?? 0)
              : undefined
          }
          canHide={scraperDebugEnabled && !usingRestResolver}
        />
      )}
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={16}
        style={{ position: 'absolute', top: 24, left: 16, zIndex: 10 }}
      >
        <Icon as={ArrowLeft} size="xl" className="text-foreground" />
      </Pressable>
    </Box>
  );
};
