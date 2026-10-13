import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'flick.playerDebug';
const SMART_PLAY_KEY = 'flick.player.smartPlay';

interface PlayerDebugSettingsContextValue {
  /**
   * When enabled, `PlayerScreen` renders its stream-resolving
   * `WebViewScraper` full-screen and interactive (instead of invisible)
   * so you can watch exactly what the embed page is doing while a stream
   * is being resolved — useful when a server fails to play. Replaces what
   * used to be a hardcoded `DEBUG_SCRAPER` constant in `PlayerScreen.tsx`.
   */
  scraperDebugEnabled: boolean;
  setScraperDebugEnabled: (next: boolean) => void;
  /**
   * Whether one playback attempt is allowed to move on by itself: to the next
   * source of the current server, then to the next server. On, a title that a
   * host hands back a broken URL for is retried elsewhere until something
   * starts playing. Off, the app stays on exactly the server and source the user
   * chose and reports the failure instead of switching behind their back.
   *
   * Lives here rather than in `usePlaybackSettings` because it is the same kind
   * of thing as the scraper debug flag: one persisted, app-wide player
   * behaviour, not a per-server or per-session value.
   */
  smartPlayEnabled: boolean;
  setSmartPlayEnabled: (next: boolean) => void;
}

const PlayerDebugSettingsContext =
  createContext<PlayerDebugSettingsContextValue>({
    scraperDebugEnabled: false,
    setScraperDebugEnabled: () => {},
    smartPlayEnabled: true,
    setSmartPlayEnabled: () => {},
  });

export const PlayerDebugSettingsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [scraperDebugEnabled, setScraperDebugEnabledState] = useState(false);
  const [smartPlayEnabled, setSmartPlayEnabledState] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw != null) setScraperDebugEnabledState(raw === 'true');
      })
      .catch(() => {});
    AsyncStorage.getItem(SMART_PLAY_KEY)
      .then((raw) => {
        // Unset means the default, which is on: automatic failover is what the
        // app has always done, so a missing key must not silently disable it.
        if (raw != null) setSmartPlayEnabledState(raw !== 'false');
      })
      .catch(() => {});
  }, []);

  const setScraperDebugEnabled = useCallback((next: boolean) => {
    setScraperDebugEnabledState(next);
    AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => {});
  }, []);

  const setSmartPlayEnabled = useCallback((next: boolean) => {
    setSmartPlayEnabledState(next);
    AsyncStorage.setItem(SMART_PLAY_KEY, String(next)).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      scraperDebugEnabled,
      setScraperDebugEnabled,
      smartPlayEnabled,
      setSmartPlayEnabled,
    }),
    [scraperDebugEnabled, setScraperDebugEnabled, smartPlayEnabled, setSmartPlayEnabled],
  );

  return (
    <PlayerDebugSettingsContext.Provider value={value}>
      {children}
    </PlayerDebugSettingsContext.Provider>
  );
};

export const usePlayerDebugSettings = () =>
  useContext(PlayerDebugSettingsContext);
