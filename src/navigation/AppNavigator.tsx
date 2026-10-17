import { useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SplashScreen } from '@/src/screens/SplashScreen';
import { LoginScreen } from '@/src/screens/LoginScreen';
import { SubscriptionScreen } from '@/src/screens/SubscriptionScreen';
import { BlockedScreen } from '@/src/screens/BlockedScreen';
import { SearchScreen } from '@/src/screens/SearchScreen';
import { DownloadsScreen } from '@/src/screens/DownloadsScreen';
import { DetailScreen } from '@/src/screens/DetailScreen';
import { PlayerScreen } from '@/src/screens/PlayerScreen';
import { LivePlayerScreen } from '@/src/screens/LivePlayerScreen';
import { ViewMoreScreen } from '@/src/screens/ViewMoreScreen';
import { SubtitleSettingsScreen } from '@/src/screens/SubtitleSettingsScreen';
import { ServerSettingsScreen } from '@/src/screens/ServerSettingsScreen';
import { VideoQualitySettingsScreen } from '@/src/screens/VideoQualitySettingsScreen';
import { VideoAspectSettingsScreen } from '@/src/screens/VideoAspectSettingsScreen';
import { RegionSettingsScreen } from '@/src/screens/RegionSettingsScreen';
import { PlaybackPerformanceScreen } from '@/src/screens/PlaybackPerformanceScreen';
import { DisclaimerScreen } from '@/src/screens/DisclaimerScreen';
import { CreditsScreen } from '@/src/screens/CreditsScreen';
import { FinishedMoviesScreen } from '@/src/screens/FinishedMoviesScreen';
import { MyListScreen } from '@/src/screens/MyListScreen';
import { TabNavigator } from './TabNavigator';
import { TVNavigator } from './TVNavigator';
import { JoinPartyScreen } from '@/src/screens/JoinPartyScreen';
import { PartyLinkHandler } from '@/src/components/party/PartyLinkHandler';
import { PartySessionBar } from '@/src/components/party/PartySessionBar';
import { isTVLayout } from '@/src/utils/tv';
import { isTablet } from '@/src/utils/responsive';
import { BACKGROUND, BORDER_COLOR, BRAND_COLOR, TEXT_COLOR } from '@/src/theme/tokens';
import { usePrefersReducedMotion } from '@/src/components/streamz';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import { gateResetFor } from '@/src/firebase/subscriptions/gate';
import { handoffAnimation, type HandoffAnimation } from '@/src/utils/startupSequence';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Keeps the stack honest against the session gate (PRD §34). Splash performs the
 * first handoff; from then on, whenever the gate's route changes — sign-in, key
 * activation, a live revocation while the app is open — the stack follows. A
 * negative verdict ejects to Blocked from anywhere; nothing may bypass the gate,
 * and no screen navigates itself.
 *
 * `currentRouteName` is the stack's own settled route, not a pull against `navigationRef`, for
 * two reasons. A gate verdict that lands before the container reports ready used to be dropped
 * and never re-examined, because nothing about the container becoming ready could wake this
 * effect; and reading the route after the fact is what let a verdict compare itself against a
 * route that had already moved on.
 */
const GateSync = ({ currentRouteName }: { currentRouteName: string | undefined }) => {
  const { route: sessionRoute, decision } = useSession();
  const prevRoute = useRef(sessionRoute);

  useEffect(() => {
    if (decision === 'bootstrapping') return;
    if (!navigationRef.isReady()) return;
    // The container is ready but has not reported a route yet, so there is nothing to compare
    // the verdict against. Returning here without consuming the verdict is the point: consuming
    // it would leave the stack showing a route the gate no longer authorises until the next
    // gate change.
    if (currentRouteName === undefined) return;
    if (prevRoute.current === sessionRoute) return;
    prevRoute.current = sessionRoute;

    // Checked at the moment the gate changes, not on every navigation: the route the user
    // is standing on may be a tab or a pushed screen inside `Main`, and the gate still
    // owns the decision about whether they belong there.
    const resetTo = gateResetFor(sessionRoute, currentRouteName);
    if (resetTo) navigationRef.reset({ index: 0, routes: [{ name: resetTo }] });
  }, [sessionRoute, decision, currentRouteName]);

  return null;
};

// The player is always landscape, on every form factor.
const playerOrientation = 'landscape';

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: BACKGROUND.base,
    card: BACKGROUND.base,
    primary: BRAND_COLOR.primary,
    text: TEXT_COLOR.primary,
    border: BORDER_COLOR.subtle,
  },
};

/**
 * One short crossfade for every handoff the gate owns, or no animation at all when the user
 * has asked for reduced motion.
 *
 * `Main` used to fall through to the stack's `slide_from_right` default, so the single most
 * common thing a user does — arrive — was a full-screen horizontal shove of the tab navigator
 * while `Splash -> Login` was a crossfade. Two different transitions out of the same splash for
 * reasons the user cannot see or care about.
 */
const useGateScreenOptions = (reduced: boolean) =>
  useMemo(
    () => ({ animation: handoffAnimation(reduced) as HandoffAnimation }),
    [reduced],
  );

export const AppNavigator = () => {
  const [routeName, setRouteName] = useState<string | undefined>();
  const reduced = usePrefersReducedMotion();
  const gateOptions = useGateScreenOptions(reduced);
  const { width, height } = useWindowDimensions();
  // Phones are locked to portrait everywhere; only the Player screen may rotate
  // to landscape. Tablets, TVs, and Mac Catalyst windows are free to rotate
  // (`default`) since they can be resized/oriented arbitrarily.
  //
  // Read from the live window, not from a module-scope `isTablet()`: a module-scope value is
  // frozen at bundle evaluation, so a foldable unfolding or a resizable window joining
  // multi-window never changed which orientation contract the stack offered. `isTVLayout` stays
  // module-scope because it is a build flag against a fixed device class.
  const appOrientation = isTVLayout || isTablet(width, height) ? 'default' : 'portrait';
  const syncRoute = () => {
    if (!navigationRef.isReady()) return;
    setRouteName(navigationRef.getCurrentRoute()?.name);
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={syncRoute}
      onStateChange={syncRoute}
    >
      <PartyLinkHandler />
      <GateSync currentRouteName={routeName} />
      <PartySessionBar routeName={routeName} />
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          orientation: appOrientation,
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} options={gateOptions} />
        <Stack.Screen name="Login" component={LoginScreen} options={gateOptions} />
        <Stack.Screen name="Subscription" component={SubscriptionScreen} options={gateOptions} />
        <Stack.Screen name="Blocked" component={BlockedScreen} options={gateOptions} />
        <Stack.Screen name="Main" component={isTVLayout ? TVNavigator : TabNavigator} options={gateOptions} />
        {/* Search and Downloads left the tab bar (search now lives in the Home
            header, downloads under Settings), so they need stack entries of
            their own. TV renders both inside its side-rail shell instead. */}
        <Stack.Screen name="Search" component={SearchScreen} />
        <Stack.Screen name="Downloads" component={DownloadsScreen} />
        <Stack.Screen
          name="Detail"
          component={DetailScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="ViewMore" component={ViewMoreScreen} />
        <Stack.Screen
          name="SubtitleSettings"
          component={SubtitleSettingsScreen}
        />
        <Stack.Screen name="ServerSettings" component={ServerSettingsScreen} />
        <Stack.Screen
          name="VideoQualitySettings"
          component={VideoQualitySettingsScreen}
        />
        <Stack.Screen
          name="VideoAspectSettings"
          component={VideoAspectSettingsScreen}
        />
        <Stack.Screen name="RegionSettings" component={RegionSettingsScreen} />
        <Stack.Screen
          name="PlaybackPerformance"
          component={PlaybackPerformanceScreen}
        />
        <Stack.Screen name="Disclaimer" component={DisclaimerScreen} />
        <Stack.Screen name="Credits" component={CreditsScreen} />
        <Stack.Screen name="FinishedMovies" component={FinishedMoviesScreen} />
        <Stack.Screen name="MyList" component={MyListScreen} />
        <Stack.Screen name="JoinParty" component={JoinPartyScreen} />
        <Stack.Screen
          name="Player"
          component={PlayerScreen}
          options={{ animation: 'fade', orientation: playerOrientation }}
        />
        <Stack.Screen
          name="LivePlayer"
          component={LivePlayerScreen}
          options={{ animation: 'fade', orientation: playerOrientation }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
