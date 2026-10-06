import { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { UpdateModal } from '@/src/components/UpdateModal';
import { StreamZLoader, StreamZText, StreamZAmbient } from '@/src/components/streamz';
import {
  StreamZSplashWordmark,
  TOTAL_MS,
  LOGO_SETTLE_MS,
  splashLogoSize,
} from '@/src/components/splash/StreamZSplashWordmark';
import { UPDATE_CONFIG } from '@/src/config/env';
import { useServers } from '@/src/hooks/useServers';
import { useHomeData } from '@/src/hooks/useHomeData';
import { useCatalogRegion } from '@/src/hooks/useCatalogRegion';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import type { RootStackScreenProps } from '@/src/navigation/types';
import { mark } from '@/src/utils/startupTiming';
import {
  updateService,
  type UpdateInfo,
} from '@/src/services/UpdateService';
import {
  clearSkippedVersion,
  isSkippedVersion,
  saveLastUpdateCheck,
  setSkippedVersion,
} from '@/src/utils/updateCheckStorage';

const LAND_MS = 200;

/**
 * Soft-fail update check so a network blip never blocks entering Main. Disabled entirely in
 * Phase 1A: with the defaults this polls the upstream Flick releases and would offer a
 * StreamZ user somebody else's APK.
 */
const checkUpdatesSafe = async (): Promise<UpdateInfo | null> => {
  if (!UPDATE_CONFIG.enabled) return null;
  try {
    return await updateService.checkForUpdates();
  } catch {
    return null;
  }
};

export const SplashScreen = ({ navigation }: RootStackScreenProps<'Splash'>) => {
  const { width: windowWidth } = useWindowDimensions();
  const { width: logoWidth, height: logoHeight } = splashLogoSize(windowWidth);
  useEffect(() => {
    mark('splash-mounted');
  }, []);
  const [showCopy, setShowCopy] = useState(false);
  const { refreshBuiltInServers } = useServers();
  const { prefetch } = useHomeData();
  const { loaded: regionLoaded } = useCatalogRegion();
  const { route: gateRoute, decision: gateDecision } = useSession();
  const gateRef = useRef({ route: gateRoute, decision: gateDecision });
  gateRef.current = { route: gateRoute, decision: gateDecision };

  const [updaterOpen, setUpdaterOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const drawDoneRef = useRef(false);
  const bootDoneRef = useRef(false);
  const didStartExitRef = useRef(false);
  const didNavigateRef = useRef(false);
  const landTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bootFnsRef = useRef({ refreshBuiltInServers, prefetch });
  bootFnsRef.current = { refreshBuiltInServers, prefetch };

  const goMain = useCallback(() => {
    if (didNavigateRef.current) return;
    didNavigateRef.current = true;
    const target = gateRef.current.route;
    mark(`splash-exit:${target}`);
    if (target === 'Main') {
      // Home data is only fetched once the gate has actually let the user in.
      void Promise.resolve(bootFnsRef.current.prefetch()).catch(() => undefined);
    }
    navigation.replace(target);
  }, [navigation]);

  const maybeExit = useCallback(() => {
    if (didStartExitRef.current) return;
    if (!drawDoneRef.current || !bootDoneRef.current) return;
    // Gate totality: never leave Splash before auth and subscription are resolved.
    if (gateRef.current.decision === 'bootstrapping') return;
    didStartExitRef.current = true;
    landTimerRef.current = setTimeout(goMain, LAND_MS);
  }, [goMain]);
  const maybeExitRef = useRef(maybeExit);
  maybeExitRef.current = maybeExit;

  const markDrawDone = useCallback(() => {
    drawDoneRef.current = true;
    setShowCopy(true);
    maybeExitRef.current();
  }, []);
  const markDrawDoneRef = useRef(markDrawDone);
  markDrawDoneRef.current = markDrawDone;
  const onIdentDrawEnd = useCallback(() => {
    markDrawDoneRef.current();
  }, []);

  const finishBoot = useCallback(async () => {
    await saveLastUpdateCheck();
    bootDoneRef.current = true;
    maybeExitRef.current();
  }, []);

  const handleCloseUpdater = useCallback(() => {
    setUpdaterOpen(false);
    void finishBoot();
  }, [finishBoot]);

  const handleSkipVersion = useCallback(async () => {
    if (updateInfo?.latestVersion) {
      await setSkippedVersion(updateInfo.latestVersion);
    }
    setUpdaterOpen(false);
    void finishBoot();
  }, [updateInfo, finishBoot]);

  useEffect(() => {
    const reveal = setTimeout(() => setShowCopy(true), LOGO_SETTLE_MS);
    const fallback = setTimeout(() => markDrawDoneRef.current(), TOTAL_MS + 80);
    return () => {
      clearTimeout(reveal);
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (gateDecision !== 'bootstrapping') mark(`gate-decision:${gateRoute}`);
    maybeExitRef.current();
  }, [gateDecision]);

  useEffect(() => {
    if (!regionLoaded) return;

    let cancelled = false;
    void (async () => {
      const { refreshBuiltInServers: refreshServers } = bootFnsRef.current;
      const [, info] = await Promise.all([refreshServers(), checkUpdatesSafe()]);
      if (cancelled) return;

      if (info?.hasUpdate) {
        const skipped = await isSkippedVersion(info.latestVersion);
        if (cancelled) return;
        if (!skipped) {
          await clearSkippedVersion();
          if (cancelled) return;
          setUpdateInfo(info);
          setUpdaterOpen(true);
          return;
        }
      }

      await saveLastUpdateCheck();
      if (!cancelled) {
        bootDoneRef.current = true;
        maybeExitRef.current();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [regionLoaded]);

  useEffect(
    () => () => {
      if (landTimerRef.current) clearTimeout(landTimerRef.current);
    },
    [],
  );

  // Status copy is keyed to the REAL gate state (PRD §4): it may never promise
  // anything the session layer has not actually decided, and technical stages
  // (firebase module, firestore fetch) are never named.
  const statusMessage =
    gateDecision === 'needsServerContact'
      ? 'Connecting…'
      : gateDecision === 'bootstrapping'
        ? 'Securing your session…'
        : 'Preparing StreamZ';

  return (
    <Box className="flex-1 bg-background">
      <Box className="absolute inset-0" pointerEvents="none">
        <StreamZAmbient />
      </Box>
      <Box
        className="absolute inset-0 items-center justify-center overflow-visible"
        pointerEvents="none"
      >
        <StreamZSplashWordmark onDrawEnd={onIdentDrawEnd} />
      </Box>

      <VStack
        space="xl"
        className="flex-1 items-center justify-center"
        pointerEvents="none"
      >
        <Box style={{ width: logoWidth, height: logoHeight + 20 }} />
        <Box className="mt-20" style={{ opacity: showCopy ? 1 : 0 }}>
          <StreamZLoader />
        </Box>
        <Box className="min-h-10 px-8" style={{ opacity: showCopy ? 1 : 0 }}>
          <StreamZText variant="secondary" className="text-center text-muted-foreground">
            {statusMessage}
          </StreamZText>
        </Box>
      </VStack>
      <UpdateModal
        visible={updaterOpen}
        onClose={handleCloseUpdater}
        initialUpdateInfo={updateInfo}
        onSkipVersion={handleSkipVersion}
      />
    </Box>
  );
};
