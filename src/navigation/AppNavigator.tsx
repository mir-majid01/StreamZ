import { useEffect, useRef, useState } from 'react';
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
import { useSession } from '@/src/firebase/auth/SessionProvider';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const GATE_ROUTES = ['Splash', 'Login', 'Subscription', 'Blocked'] as const;

/**
 * Keeps the stack honest against the session gate (PRD §34). Splash performs the
 * first handoff; from then on, whenever the gate's route changes — sign-in, key
 * activation, a live revocation while the app is open — the stack follows. A
 * negative verdict ejects to Blocked from anywhere; nothing may bypass the gate,
 * and no screen navigates itself.
 */
const GateSync = () => {
  const { route: sessionRoute, decision } = useSession();
  const prevRoute = useRef(sessionRoute);

  useEffect(() => {
    if (decision === 'bootstrapping') return;
    if (!navigationRef.isReady()) return;
    if (prevRoute.current === sessionRoute) return;
    prevRoute.current = sessionRoute;

    const current = navigationRef.getCurrentRoute()?.name;
    // Splash owns the initial handoff; never race it.
    if (!current || current === 'Splash') return;

    if (sessionRoute === 'Blocked') {
      navigationRef.reset({ index: 0, routes: [{ name: 'Blocked' }] });
      return;
    }
    if (GATE_ROUTES.includes(current as (typeof GATE_ROUTES)[number]) && current !== sessionRoute) {
      navigationRef.reset({ index: 0, routes: [{ name: sessionRoute }] });
    }
  }, [sessionRoute, decision]);

  return null;
};

// Phones are locked to portrait everywhere; only the Player screen may rotate
// to landscape. Tablets, TVs, and Mac Catalyst windows are free to rotate
// (`default`) since they can be resized/oriented arbitrarily.
const flexibleDevice = isTVLayout || isTablet();
const appOrientation = flexibleDevice ? 'default' : 'portrait';
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

export const AppNavigator = () => {
  const [routeName, setRouteName] = useState<string | undefined>();
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
      <GateSync />
      <PartySessionBar routeName={routeName} />
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          orientation: appOrientation,
        }}
      >
        <Stack.Screen
          name="Splash"
          component={SplashScreen}
          options={{ animation: 'fade' }}
        />
        <Stack.Screen name="Login" component={LoginScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Subscription" component={SubscriptionScreen} options={{ animation: 'fade' }} />
        <Stack.Screen name="Blocked" component={BlockedScreen} options={{ animation: 'fade' }} />
        <Stack.Screen
          name="Main"
          component={isTVLayout ? TVNavigator : TabNavigator}
        />
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
