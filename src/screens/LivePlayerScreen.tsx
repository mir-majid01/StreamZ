import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, useWindowDimensions } from 'react-native';
import Video, { type ReactVideoSource } from 'react-native-video';
import { useKeepAwake } from 'expo-keep-awake';
import { ArrowLeft, VideoOff } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { PlayerControls } from '@/src/components/player/PlayerControls';
import { LivePlayerChannelDrawer } from '@/src/components/player/LivePlayerChannelDrawer';
import { useControlsVisibility } from '@/src/components/player/useControlsVisibility';
import { useImmersivePlayerChrome } from '@/src/components/player/useImmersivePlayerChrome';
import { useTVRemote } from '@/src/components/player/useTVRemote';
import {
  DaddyLiveService,
  friendlyLiveTvError,
  type LiveChannel,
  type LiveStream,
} from '@/src/services/DaddyLiveService';
import { liveSourceType, urlDeclaresContainer } from '@/src/services/liveTv/sourceType';
import {
  livePlaybackDetail,
  playbackErrorResourceUrl,
  type PlayerErrorPayload,
} from '@/src/services/liveTv/playbackError';
import {
  automaticRetryNotice,
  classifyPlaybackFailure,
  retryDelayMsFor,
  shouldRetry,
  type PlaybackFailure,
} from '@/src/services/liveTv/playbackFailure';
import { probeStreamChain, type StreamProbeChain, type StreamProbeResult } from '@/src/services/liveTv/streamProbe';
import {
  EMPTY_LIVE_TELEMETRY,
  LIVE_BUFFER_CONFIG,
  LIVE_FORWARD_BUFFER_SECONDS,
  formatLiveTelemetry,
  liveSilentStreamNotice,
  type LivePlaybackTelemetry,
} from '@/src/services/liveTv/livePlaybackTuning';
import { FONT } from '@/src/theme/tokens';
import { isTV } from '@/src/utils/tv';
import type { RootStackScreenProps } from '@/src/navigation/types';

const playbackDiagnosticSummary = (failure: PlaybackFailure | null): string | null => {
  if (!failure) return null;
  const lines = [
    failure.resourceKind ? `resource=${failure.resourceKind}` : null,
    failure.status != null ? `HTTP ${failure.status}` : null,
    failure.contentType ? `content-type=${failure.contentType}` : null,
    failure.finalUrl ? `final=${failure.finalUrl}` : null,
    failure.bodyPreview
      ? `body=${failure.bodyPreview}${failure.bodyPreviewTruncated ? '…' : ''}`
      : null,
    failure.nativeException ? `native=${failure.nativeException}` : null,
  ].filter(Boolean);
  return lines.length ? lines.join('\n') : null;
};

export const LivePlayerScreen = ({
  route,
  navigation,
}: RootStackScreenProps<'LivePlayer'>) => {
  const { channel: initialChannel, stream: initialStream } = route.params;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // The channel list is read from the service rather than handed in through params: the
  // merged catalogue is ~12.5k entries, and as a param every one of them stayed reachable
  // for the lifetime of the stack entry, whether or not the drawer was ever opened.
  const channels = useMemo(
    () => DaddyLiveService.getPlaylistCatalogue(),
    [],
  );

  useKeepAwake('flick-live-player');

  const [channel, setChannel] = useState<LiveChannel>(initialChannel);
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerDetail, setPlayerDetail] = useState<string | null>(null);
  /** Redacted transport/native evidence retained for the final error report. */
  const [playbackDiagnostics, setPlaybackDiagnostics] = useState<PlaybackFailure | null>(null);
  /**
   * What this tune actually did, in numbers. Kept off the success path's UI and shown only
   * with a failure, because a working channel does not need a HUD — but a failed one should
   * say whether it ever produced a frame and how many times it stalled, instead of leaving
   * the report at "it broke".
   */
  const [telemetry, setTelemetry] = useState<LivePlaybackTelemetry>(EMPTY_LIVE_TELEMETRY);
  /** `Date.now()` when the player was asked for this source; null before it was asked. */
  const loadStartedAtRef = useRef<number | null>(null);
  /** When the current stall began, or null when the player is not buffering. */
  const bufferingSinceRef = useRef<number | null>(null);
  /**
   * Automatic retries the screen had already spent when it gave up, or null when nothing failed.
   * Kept so the error state can say it tried twice on its own instead of looking like a first
   * attempt — the classification itself is already in `error` and `playerDetail`.
   */
  const [retriesSpent, setRetriesSpent] = useState<number | null>(null);
  /** "Retrying (1 of 2)…" while an automatic retry is queued or re-arming. */
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(1);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  /**
   * Bumped for every attempt, automatic or user-pressed, and folded into the `<Video>` key.
   * react-native-video keeps one ExoPlayer per host view and refuses to re-prepare a source it
   * considers unchanged — see the evidence on `rearm` below — so remounting the element is the
   * only way a retry reaches the player as a new tune instead of a no-op.
   */
  const [attemptToken, setAttemptToken] = useState(0);
  /**
   * Automatic retries spent on the current tune. Reset only by starting a tune (a new channel, or
   * the user pressing Try again) — never by a successful load, which is what keeps the total number
   * of automatic attempts a screen makes bounded even if a channel flaps for an hour.
   */
  const autoRetriesRef = useRef(0);
  /** Whether the player ever reported the stream loaded, for media3's catch-all IO codes. */
  const playbackStartedRef = useRef(false);
  /**
   * Last pre-flight probe of the stream URL. Only ever set on the retry path, and it sharpens the
   * next classification and the source hint instead of blaming the user's connection.
   */
  const [chain, setChain] = useState<StreamProbeChain | null>(null);
  const probe: StreamProbeResult | null = chain?.top ?? null;
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The in-flight question to the stream host, so leaving the channel can cancel it. */
  const probeRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const overlayOpen = channelsOpen;
  const { visible, show, toggle } = useControlsVisibility(!paused, overlayOpen);
  const diagnosticSummary = playbackDiagnosticSummary(playbackDiagnostics);
  // Measured, not inferred: a tune that never produced a frame says so by saying nothing.
  const telemetryLine = formatLiveTelemetry(telemetry);
  // Shown while the picture plays: a silent stream is not an error, so the failure panel below
  // would never appear, and the viewer would be left with moving pictures, no sound, and no word
  // about which of the two causes it is.
  const silentNotice = liveSilentStreamNotice(telemetry);

  // The window itself (landscape, hidden system bars, and giving both back on the way out) is
  // owned by the shared hook, because the same chrome is what made the tab bar jump after a movie
  // and after a live channel: see `useImmersivePlayerChrome`.
  useImmersivePlayerChrome(navigation);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // A probe still in flight when the player is closed has no screen left to report to.
      const inFlight = probeRef.current;
      probeRef.current = null;
      if (inFlight) {
        try {
          inFlight.abort();
        } catch {
          // Nothing to clean up if the abort itself failed.
        }
      }
    };
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /**
   * Cancels a question already asked to the stream host.
   *
   * The probe is one bounded request, but "bounded" is not the same as "belongs to a channel the
   * user has left". Changing channel or backing out of the player aborts it, so a slow answer about
   * the previous tune can never arrive late and be drawn as the diagnosis of the new one.
   */
  const cancelProbe = useCallback(() => {
    const active = probeRef.current;
    probeRef.current = null;
    if (!active) return;
    try {
      active.abort();
    } catch {
      // An abort that throws changes nothing: the probe's own deadline still ends it.
    }
  }, []);

  /**
   * Ask the host that just failed the player what it actually says, once, bounded.
   *
   * This exists because media3's HTTP failure payload names the condition (`ERROR_CODE_IO_BAD_HTTP_STATUS`)
   * and never carries the status, and 403, 404, 429 and 502 are four different facts with four
   * different answers to "will trying again help". The result is an observation, not a verdict:
   * `classifyPlaybackFailure` decides what it means.
   */
  const askTheHost = useCallback(
    async (target: LiveStream, resourceUrl?: string | null): Promise<StreamProbeChain | null> => {
      const url = resourceUrl || target.url;
      if (!url) return null;
      const controller = new AbortController();
      probeRef.current = controller;
      try {
        const chain = await probeStreamChain(url, {
          headers: target.headers,
          signal: controller.signal,
        });
        // The probe's own round-trip is the only playlist latency number this app can
        // measure: media3 reports load failures, not per-request timing.
        if (chain) {
          setTelemetry((t) => ({ ...t, playlistLatencyMs: chain.top.ms }));
        }
        return chain;
      } catch {
        return null;
      } finally {
        if (probeRef.current === controller) probeRef.current = null;
      }
    },
    [],
  );

  /**
   * Everything that must be forgotten the moment the screen starts a new tune: the retries spent,
   * the diagnosis on screen, the retry notice, the probe that informed it, and the player itself
   * (the bumped token remounts `<Video>`, which is the only thing that reliably discards an
   * ExoPlayer instance that has already reported an error).
   */
  const resetAttemptState = useCallback(() => {
    clearRetryTimer();
    // A new tune means the previous one's evidence is void: the stale probe is cancelled rather
    // than left running, and its answer is discarded rather than carried into the new diagnosis.
    cancelProbe();
    autoRetriesRef.current = 0;
    playbackStartedRef.current = false;
    loadStartedAtRef.current = null;
    bufferingSinceRef.current = null;
    setTelemetry(EMPTY_LIVE_TELEMETRY);
    setChain(null);
    setRetriesSpent(null);
    setRetryNotice(null);
    setPlaybackDiagnostics(null);
    setAttemptToken((token) => token + 1);
  }, [cancelProbe, clearRetryTimer]);

  /**
   * Find out what the host is actually serving before the player is built — but only for the URLs
   * that do not say.
   *
   * `liveSourceType` has to answer with a container hint because media3 chooses its parser from that
   * hint and never sniffs the response, and its fallback for an unreadable path is HLS. A raw
   * MPEG-TS body behind `…/play/<token>` therefore went to the HLS parser, failed the first tune,
   * and only became playable once a retry had probed it and re-typed it — which is the "black
   * screen, then it works when I tap again" report. One bounded request turns that guess into an
   * observation up front. Channels whose URL already ends in `.m3u8` or `.mpd` skip it entirely, so
   * the ~96% that describe themselves keep the immediate start they had before.
   */
  const primeContainer = useCallback(
    async (target: LiveStream): Promise<void> => {
      if (!target.url || urlDeclaresContainer(target.url)) return;
      await askTheHost(target);
    },
    [askTheHost],
  );

  const loadStream = useCallback(async (next: LiveChannel) => {
    // One token per request, and only the newest one may write. Channel taps are not
    // serialized: two taps start two resolvers, and whichever answered last used to win,
    // so a slow tune for a channel the user already left could overwrite the current one.
    const requestId = ++requestIdRef.current;
    resetAttemptState();
    setLoading(true);
    setError(null);
    setPlayerDetail(null);
    setPlaybackDiagnostics(null);
    setStream(null);
    setResolvingId(next.id);
    try {
      const resolved = await DaddyLiveService.getStream(next.id);
      if (requestId !== requestIdRef.current) return;
      // Still inside the loading window on purpose: the player is not handed a URL until the
      // answer that decides which parser builds it has arrived or timed out.
      await primeContainer(resolved);
      if (requestId !== requestIdRef.current) return;
      setChannel(next);
      setStream(resolved);
      void DaddyLiveService.pushRecent(next.id);
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(friendlyLiveTvError(e));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setResolvingId(null);
      }
    }
  }, [primeContainer, resetAttemptState]);

  useEffect(() => {
    if (!initialStream?.url) {
      void loadStream(initialChannel);
      return;
    }
    // A stream handed over by the caller still needs the same up-front question when its URL
    // does not name its container; skipping it here would leave that path with the old bug.
    const requestId = ++requestIdRef.current;
    void (async () => {
      await primeContainer(initialStream);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setChannel(initialChannel);
      setStream(initialStream);
      setLoading(false);
      void DaddyLiveService.pushRecent(initialChannel.id);
    })();
  }, [initialChannel, initialStream, loadStream, primeContainer]);

  const source = useMemo<ReactVideoSource | null>(() => {
    if (!stream?.url) return null;
    return {
      uri: stream.url,
      // The probe's Content-Type outranks the URL's extension, and only a probe that saw a media
      // type changes the answer. `primeContainer` guarantees that question has been asked before
      // the first tune whenever the path does not name its container; a self-describing `.m3u8`
      // still starts on the extension alone, with no round trip in front of it.
      type: liveSourceType(stream.url, probe),
      headers: stream.headers,
    };
  }, [stream, probe]);

  /**
   * Re-arms playback for the channel already on screen. Two things happen in this order and both
   * matter: the stream URL is asked what it is (bounded, never on the first playback), and the
   * `<Video>` element is remounted by changing its key.
   *
   * The remount is not decoration. In react-native-video 6.19.2 `onPlayerError`
   * (ReactExoplayerView.java:1993-2024) sets `playerNeedsSource = true` and emits the event, but
   * only re-initialises the player for DRM failures (line 2007). A behind-live-window error takes a
   * narrower path — `clearResumePosition(); player.seekToDefaultPosition(); player.prepare()` — not
   * `initializePlayer()`, which is what the task notes claimed. For every other error the JS side is
   * left holding a live view whose ExoPlayer has gone idle, and re-passing the same `source` prop is
   * a no-op: `setSrc` (line 2079) compares the incoming `Source` with `Source.isEquals`, and
   * `Source.equals` (common/api/Source.kt:95) is structural over uri, extension, the three position
   * fields, DRM/ads/CMCD/buffer config — headers are notably not part of it. So a retry of the same
   * URL never sets `playerNeedsSource` and never calls `initializePlayer()`. A remount runs
   * `onDropViewInstance` -> `cleanUpResources()` -> `releasePlayer()` -> `player.release()`
   * (ReactExoplayerViewManager.kt:71, ReactExoplayerView.java:402/1261) and builds a fresh player
   * that prepares at the live edge.
   */
  const rearm = useCallback(
    async (target: LiveStream | null, requestId: number): Promise<void> => {
      if (target?.url) {
        const result = await askTheHost(target);
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setChain(result ?? null);
      }
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      playbackStartedRef.current = false;
      setError(null);
      setRetriesSpent(null);
      setPlayerDetail(null);
      setAttemptToken((token) => token + 1);
    },
    [askTheHost],
  );

  /**
   * What the player reported, in the user's language, with the retries spent.
   *
   * Async because one of its branches has to ask the host a question before it can honestly name
   * the failure: media3's HTTP-status payload carries the condition and not the status. Everything
   * this function writes is guarded by the request id it started with, so a diagnosis computed
   * after the user changed channel is thrown away rather than painted on the new screen.
   */
  const handlePlaybackError = useCallback(
    async (payload: PlayerErrorPayload): Promise<void> => {
      const requestId = requestIdRef.current;
      const url = stream?.url ?? null;
      let classified = classifyPlaybackFailure({
        payload,
        url,
        probe,
        chain,
        playbackStarted: playbackStartedRef.current,
      });

      // A bad HTTP status with no status read yet is the one case where the app can go and find
      // out, and it is worth one bounded request: 403, 404, 429 and 502 need four different
      // sentences, and only a retry decision that differs too.
      if (
        stream !== null &&
        classified.codeName === 'ERROR_CODE_IO_BAD_HTTP_STATUS' &&
        classified.status === null
      ) {
        const failedResourceUrl = playbackErrorResourceUrl(payload) ?? stream.url;
        const answer = await askTheHost(stream, failedResourceUrl);
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        if (answer) {
          setChain(answer);
          classified = classifyPlaybackFailure({
            payload,
            url,
            probe: answer.top,
            chain: answer,
            playbackStarted: playbackStartedRef.current,
          });
        }
      }

      setPlaybackDiagnostics(classified);

      // Kept even when a plain-language sentence is available: which media3 code the stream raised
      // is the only thing that separates a publisher outage from a container this device cannot
      // read, and it is what makes a report actionable.
      setPlayerDetail(livePlaybackDetail(payload));

      if (shouldRetry(classified, autoRetriesRef.current)) {
        const attempt = autoRetriesRef.current + 1;
        autoRetriesRef.current = attempt;
        setRetriesSpent(null);
        setError(null);
        setRetryNotice(automaticRetryNotice(attempt));
        clearRetryTimer();
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void rearm(stream, requestId);
        }, retryDelayMsFor(classified, attempt));
        return;
      }

      clearRetryTimer();
      setRetryNotice(null);
      setRetriesSpent(autoRetriesRef.current);
      setError(classified.message);
    },
    [askTheHost, clearRetryTimer, probe, rearm, stream],
  );

  /** The user's own retry: re-resolve first, so a spent stream token gets a fresh one. */
  const handleTryAgain = useCallback(() => {
    void loadStream(channel);
  }, [channel, loadStream]);

  const handleSelectChannel = useCallback(
    (next: LiveChannel) => {
      setChannelsOpen(false);
      // Tapping the channel already on screen is a re-tune when it has failed, not a no-op.
      if (next.id === channel.id && !error) return;
      void loadStream(next);
    },
    [channel.id, error, loadStream],
  );

  useTVRemote({
    onPlayPause: overlayOpen ? undefined : () => setPaused((p) => !p),
    onSelect: undefined,
    onUp: overlayOpen ? undefined : show,
    onDown: overlayOpen ? undefined : show,
  });

  /**
   * The clock starts when the player is asked for a source, not when the screen was drawn:
   * a tune waits on the resolver first, and folding that wait into "time to first frame"
   * would blame the player for the service.
   */
  const handleLoadStart = useCallback(() => {
    loadStartedAtRef.current = Date.now();
    bufferingSinceRef.current = null;
    setTelemetry((t) =>
      t.firstFrameMs === null && t.rebufferCount === 0 && t.rebufferTotalMs === 0
        ? t
        : { ...EMPTY_LIVE_TELEMETRY, playlistLatencyMs: t.playlistLatencyMs },
    );
  }, []);

  const handleFirstFrame = useCallback(() => {
    const started = loadStartedAtRef.current;
    if (started === null) return;
    setTelemetry((t) =>
      t.firstFrameMs === null ? { ...t, firstFrameMs: Date.now() - started } : t,
    );
  }, []);

  /**
   * A buffer event before the first frame is the tune still filling, not a rebuffer. Only
   * stalls after a frame has been shown are counted — that is the number a viewer would
   * recognise as "it froze".
   */
  const handleBuffer = useCallback(({ isBuffering }: { isBuffering: boolean }) => {
    if (isBuffering) {
      if (bufferingSinceRef.current !== null) return;
      bufferingSinceRef.current = Date.now();
      setTelemetry((t) =>
        t.firstFrameMs === null ? t : { ...t, rebufferCount: t.rebufferCount + 1 },
      );
      return;
    }
    const since = bufferingSinceRef.current;
    bufferingSinceRef.current = null;
    if (since === null) return;
    setTelemetry((t) =>
      t.firstFrameMs === null
        ? t
        : { ...t, rebufferTotalMs: t.rebufferTotalMs + (Date.now() - since) },
    );
  }, []);

  const openChannels = useCallback(() => setChannelsOpen(true), []);
  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <Box className="flex-1 bg-black">
      <StatusBar hidden />
      {source && !loading ? (
        <Video
          // Channel id alone is not enough: a retry of the same channel hands the player the same
          // URL, which react-native-video considers an unchanged source, so the token is what
          // forces a fresh ExoPlayer. See `rearm`.
          key={`${channel.id}:${attemptToken}`}
          source={source}
          style={
            isTV
              ? StyleSheet.absoluteFill
              : { width: windowWidth, height: windowHeight }
          }
          controls={false}
          resizeMode="contain"
          pointerEvents="none"
          paused={paused}
          volume={volume}
          playInBackground={false}
          ignoreSilentSwitch="ignore"
          onLoad={(payload) => {
            // The stream opened and its index parsed, so anything raised later is mid-stream.
            playbackStartedRef.current = true;
            // Counted from the player's own report, not from the playlist: this is the only place
            // the app can learn whether the tune offered any audio at all. It is the difference
            // between a feed that carries no sound and one whose audio was dropped downstream,
            // and those two need different fixes — so the number goes on the failure panel too.
            setTelemetry((t) => ({
              ...t,
              audioTrackCount: payload?.audioTracks?.length ?? 0,
            }));
            clearRetryTimer();
            setRetryNotice(null);
            setRetriesSpent(null);
            setError(null);
            setPlayerDetail(null);
            setPlaybackDiagnostics(null);
          }}
          // Live numbers, not the VOD ones: a bounded offset behind the edge and a small
          // catch-up window, instead of media3's unconfigured defaults. See the rationale
          // in `livePlaybackTuning`.
          bufferConfig={LIVE_BUFFER_CONFIG}
          // iOS has no bufferConfig; AVPlayer takes the forward-buffer duration in seconds.
          preferredForwardBufferDuration={LIVE_FORWARD_BUFFER_SECONDS}
          onLoadStart={handleLoadStart}
          onReadyForDisplay={handleFirstFrame}
          onBuffer={handleBuffer}
          onError={handlePlaybackError}
        />
      ) : null}

      {loading ? (
        <Center style={StyleSheet.absoluteFill} className="bg-black">
          <Spinner size="large" color="#E50914" />
          <Text className="mt-4 text-muted-foreground">
            Tuning {channel.name}…
          </Text>
        </Center>
      ) : null}

      {retryNotice && !loading && !error ? (
        // Not a blank screen and not a fake progress bar: the count is the truth of how many
        // attempts the app is spending on its own.
        <Center pointerEvents="none" style={StyleSheet.absoluteFill} className="bg-black/70">
          <Spinner size="large" color="#E50914" />
          <Text className="mt-4 text-center text-muted-foreground">{retryNotice}</Text>
          {playerDetail ? (
            <Text
              size="xs"
              className="mt-2 text-center text-muted-foreground"
              style={{ fontFamily: FONT.mono }}
            >
              {playerDetail}
            </Text>
          ) : null}
          {playbackDiagnostics ? (
            <Text
              size="xs"
              className="mt-3 max-w-3xl text-center text-muted-foreground"
              style={{ fontFamily: FONT.mono }}
            >
              {diagnosticSummary}
            </Text>
          ) : null}
        </Center>
      ) : null}

      {error && !loading ? (
        <Center
          // Above PlayerControls, whose root is a full-screen Pressable: the two actions below
          // have to be tappable the moment a channel fails. The drawer is z-50, so "Choose
          // another channel" still lands on top of this layer.
          style={[StyleSheet.absoluteFill, { zIndex: 20 }]}
          className="bg-black px-8"
        >
          <Icon as={VideoOff} size="xl" className="mb-4 text-muted-foreground" />
          <Text size="lg" bold className="text-center text-foreground">
            Can’t play this channel
          </Text>
          <Text size="sm" className="mt-2 text-center text-muted-foreground">
            {error}
          </Text>
          {playerDetail ? (
            // Not decoration: which ExoPlayer error the stream raised is the only thing
            // that tells a publisher outage apart from a container this device can not
            // read, and without it every report arrives as "a channel does not work".
            <Text
              size="xs"
              className="mt-3 text-center text-muted-foreground"
              style={{ fontFamily: FONT.mono }}
            >
              {playerDetail}
            </Text>
          ) : null}
          {telemetryLine ? (
            // What this tune actually did before it failed — the numbers a report needs.
            <Text
              size="xs"
              className="mt-2 text-center text-muted-foreground"
              style={{ fontFamily: FONT.mono }}
            >
              {telemetryLine}
            </Text>
          ) : null}
          {diagnosticSummary ? (
            <Text
              size="xs"
              className="mt-3 max-w-3xl text-center text-muted-foreground"
              style={{ fontFamily: FONT.mono }}
            >
              {diagnosticSummary}
            </Text>
          ) : null}
          {(retriesSpent ?? 0) > 0 ? (
            // The app already spent its own retries on this tune. Saying so is the difference
            // between a screen that quit and a screen that tried — and it tells the user their
            // press of Try again is attempt three, not a repeat of attempt one.
            <Text size="xs" className="mt-2 text-center text-muted-foreground">
              Tried again on its own {retriesSpent} time{retriesSpent === 1 ? '' : 's'} before
              stopping here.
            </Text>
          ) : null}
          <HStack space="md" className="mt-5">
            <Button size="sm" variant="default" onPress={handleTryAgain}>
              <ButtonText>Try again</ButtonText>
            </Button>
            <Button size="sm" variant="outline" onPress={openChannels}>
              <ButtonText>Choose another channel</ButtonText>
            </Button>
          </HStack>
        </Center>
      ) : null}

      {silentNotice !== null && !error && !loading ? (
        // Top-centred, transparent to touch, and only when nothing else is on screen: the picture
        // is playing, so this must not cover it or steal a press meant for the controls.
        <Box pointerEvents="none" className="absolute left-0 right-0 top-0 items-center pt-3">
          <Text
            size="xs"
            className="max-w-2xl rounded-full bg-black/70 px-4 py-2 text-center text-destructive"
          >
            {silentNotice}
          </Text>
        </Box>
      ) : null}

      {visible && !loading ? (
        <PlayerControls
          title={channel.name}
          subtitle={channel.nowPlaying}
          playing={!paused}
          currentTime={0}
          duration={0}
          isLive
          onOverlayPress={toggle}
          onBack={handleBack}
          onTogglePlay={() => setPaused((p) => !p)}
          onSeekBy={() => {}}
          onScrub={() => {}}
          onScrubEnd={() => {}}
          onOpenEpisodes={channels.length ? openChannels : undefined}
          volume={volume}
          onVolumeChange={setVolume}
        />
      ) : null}

      {!visible && !overlayOpen && !loading && !error ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={show}
          focusable
          hasTVPreferredFocus
        />
      ) : null}

      {error && !loading ? (
        <Pressable
          onPress={handleBack}
          hitSlop={16}
          // 30, not 10: the error overlay is an opaque full-screen layer at z-20, and this arrow
          // only ever exists while that overlay is up.
          style={{ position: 'absolute', top: 24, left: 16, zIndex: 30 }}
        >
          <Icon as={ArrowLeft} size="xl" className="text-foreground" />
        </Pressable>
      ) : null}

      <LivePlayerChannelDrawer
        visible={channelsOpen}
        channels={channels}
        activeChannelId={channel.id}
        resolvingId={resolvingId}
        onSelect={handleSelectChannel}
        onClose={() => setChannelsOpen(false)}
      />
    </Box>
  );
};
