import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, useWindowDimensions } from 'react-native';
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
import { evaluateReleasePolicy } from '@/src/firebase/release/policy';
import type { RootStackScreenProps } from '@/src/navigation/types';
import { mark } from '@/src/utils/startupTiming';
import { installedReleaseVersion } from '@/src/utils/appVersion';
import type { UpdateInfo } from '@/src/services/UpdateService';
import {
  policyUpdateInfo,
  type ReleasePolicy,
  type UpdateDecision,
  type UpdateVerdict,
} from '@/src/utils/releasePolicy';
import {
  clearSkippedVersion,
  isSkippedVersion,
  saveLastUpdateCheck,
  setSkippedVersion,
} from '@/src/utils/updateCheckStorage';

/**
 * The boot-time release check is a soft failure by design: no policy, a refused read, a timeout,
 * or a malformed document all resolve to `unknown`, and `unknown` lets the user in. Only a policy
 * that says this build is below `minimumSupportedVersion` is allowed to hold the splash open.
 * With `FEATURES.updateChecker` off this never runs at all.
 */
const checkPolicySafe = async (): Promise<UpdateDecision | null> => {
  if (!UPDATE_CONFIG.enabled) return null;
  try {
    return await evaluateReleasePolicy();
  } catch {
    return null;
  }
};

/**
 * The modal renders `UpdateInfo`; the policy is the authoritative source, so the
 * view fields are derived from it rather than fetched a second time from GitHub.
 * `installedVersion` is read through the same helper the gate compared against,
 * so the version shown and the version decided on cannot disagree.
 */
const infoFromPolicy = (policy: ReleasePolicy, verdict: UpdateVerdict): UpdateInfo =>
  policyUpdateInfo(policy, verdict, installedReleaseVersion());

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
  const [updatePolicy, setUpdatePolicy] = useState<ReleasePolicy | null>(null);
  const [updateMandatory, setUpdateMandatory] = useState(false);
  const drawDoneRef = useRef(false);
  const bootDoneRef = useRef(false);
  const didStartExitRef = useRef(false);
  const didNavigateRef = useRef(false);
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
    goMain();
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
    // Belt and braces: the mandatory modal never renders a close affordance,
    // and closing it is not a path into the app even if something calls this.
    if (updateMandatory) return;
    setUpdaterOpen(false);
    void finishBoot();
  }, [finishBoot, updateMandatory]);

  // A mandatory update has no way into the app, so the only thing Exit can
  // honestly do is close it. There is no "continue anyway" behind it.
  const handleExitApp = useCallback(() => {
    BackHandler.exitApp();
  }, []);

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
    // Playback servers are needed for the player, not for the gate — fetch them
    // in the background from mount (cache first, then network) so the splash
    // never waits on a server round-trip before handing off to Login/Main.
    void Promise.resolve(bootFnsRef.current.refreshBuiltInServers()).catch(
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (!regionLoaded) return;

    let cancelled = false;
    void (async () => {
      const decision = await checkPolicySafe();
      if (cancelled) return;

      // `unknown` and `upToDate` both continue: not knowing the release state
      // is never a reason to hold the door shut, and never a claim of being current either.
      if (
        decision &&
        (decision.verdict === 'mandatory' || decision.verdict === 'optional') &&
        decision.policy
      ) {
        const policy = decision.policy;
        // Only an optional update may be skipped, and a skip recorded for
        // another verdict cannot carry over into a mandatory one.
        const skippable = !decision.blocks;
        const skipped = skippable
          ? await isSkippedVersion(policy.latestVersion)
          : false;
        if (cancelled) return;
        if (!skipped) {
          if (skippable) await clearSkippedVersion();
          if (cancelled) return;
          setUpdateInfo(infoFromPolicy(policy, decision.verdict));
          setUpdatePolicy(policy);
          setUpdateMandatory(decision.blocks);
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

  // Status copy is keyed to the REAL gate state (PRD §4): it may never promise
  // anything the session layer has not actually decided, and technical stages
  // (firebase module, firestore fetch) are never named.
  const statusMessage =
    gateDecision === 'bootstrapping'
      ? 'Checking access…'
      : gateDecision === 'needsServerContact'
        ? 'Connecting…'
        : 'Preparing StreamZ…';

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
        onSkipVersion={updateMandatory ? undefined : handleSkipVersion}
        policy={updatePolicy}
        mandatory={updateMandatory}
        onExit={handleExitApp}
      />
    </Box>
  );
};
