import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { AppNavigator } from '@/src/navigation/AppNavigator';
import { SessionProvider } from '@/src/firebase/auth/SessionProvider';
import { SubtitleSettingsProvider } from '@/src/hooks/useSubtitleSettings';
import { ContinueWatchingProvider } from '@/src/hooks/useContinueWatching';
import { FinishedMoviesProvider } from '@/src/hooks/useFinishedMovies';
import { ServersProvider } from '@/src/hooks/useServers';
import { MyListProvider } from '@/src/hooks/useMyList';
import { CatalogRegionProvider } from '@/src/hooks/useCatalogRegion';
import { HomeDataProvider } from '@/src/hooks/useHomeData';
import { VideoQualityProvider } from '@/src/hooks/useVideoQuality';
import { VideoAspectProvider } from '@/src/hooks/useVideoAspect';
import { PlayerDebugSettingsProvider } from '@/src/hooks/usePlayerDebugSettings';
import { PlaybackSettingsProvider } from '@/src/hooks/usePlaybackSettings';
import { DownloadsProvider } from '@/src/hooks/useDownloads';
import { WatchPartyProvider } from '@/src/hooks/useWatchParty';
import { DownloadResolverHost } from '@/src/components/DownloadResolverHost';
import { UpdateChecker } from '@/src/components/UpdateChecker';
import { UPDATE_CONFIG } from '@/src/config/env';
import { lockPortrait } from '@/src/utils/orientation';
import { bootstrapDownloadPermissions } from '@/src/utils/downloadPermissions';
import { mark } from '@/src/utils/startupTiming';
import '@/global.css';

mark('app-module-evaluated');

// Type-scale families (src/theme/tokens.ts FONT). Loaded at the root so no
// screen can paint with the fallback system face flickering underneath.
const FONTS = {
  'SpaceGrotesk-400': require('./assets/fonts/SpaceGrotesk-400.ttf'),
  'SpaceGrotesk-500': require('./assets/fonts/SpaceGrotesk-500.ttf'),
  'SpaceGrotesk-600': require('./assets/fonts/SpaceGrotesk-600.ttf'),
  'SpaceGrotesk-700': require('./assets/fonts/SpaceGrotesk-700.ttf'),
  'Inter-400': require('./assets/fonts/Inter-400.ttf'),
  'Inter-500': require('./assets/fonts/Inter-500.ttf'),
  'Inter-600': require('./assets/fonts/Inter-600.ttf'),
  'Inter-700': require('./assets/fonts/Inter-700.ttf'),
  'Inter-800': require('./assets/fonts/Inter-800.ttf'),
};

export default function App() {
  const [fontsLoaded] = useFonts(FONTS);

  useEffect(() => {
    if (fontsLoaded) mark('fonts-loaded');
  }, [fontsLoaded]);

  useEffect(() => {
    mark('first-react-commit');
    lockPortrait();
    // Ask for notification permission once, on the very first launch, so
    // downloads can surface progress notifications without silently failing.
    // Subsequent launches are a no-op; the actual Download button re-asks
    // if permission was denied.
    void bootstrapDownloadPermissions();
  }, []);

  // Local TTFs decode in tens of milliseconds; holding the (black) native
  // window for that beat is invisible, while rendering text before the fonts
  // land would flash the wrong face under every provider.
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <GluestackUIProvider mode="dark">
          <SessionProvider>
            <ServersProvider>
            <MyListProvider>
              <CatalogRegionProvider>
                <HomeDataProvider>
                  <SubtitleSettingsProvider>
                    <VideoQualityProvider>
                      <VideoAspectProvider>
                        <PlayerDebugSettingsProvider>
                          <PlaybackSettingsProvider>
                            <FinishedMoviesProvider>
                              <ContinueWatchingProvider>
                                <DownloadsProvider>
                                  <WatchPartyProvider>
                                    <StatusBar style="light" />
                                    <AppNavigator />
                                    <DownloadResolverHost />
                                    {UPDATE_CONFIG.enabled ? <UpdateChecker /> : null}
                                  </WatchPartyProvider>
                                </DownloadsProvider>
                              </ContinueWatchingProvider>
                            </FinishedMoviesProvider>
                          </PlaybackSettingsProvider>
                        </PlayerDebugSettingsProvider>
                      </VideoAspectProvider>
                    </VideoQualityProvider>
                  </SubtitleSettingsProvider>
                </HomeDataProvider>
              </CatalogRegionProvider>
            </MyListProvider>
            </ServersProvider>
          </SessionProvider>
        </GluestackUIProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
