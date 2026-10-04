import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { parsePartyCodeFromUrl } from '@/src/party/protocol';
import { FEATURES } from '@/src/config/features';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import type { RootStackParamList } from '@/src/navigation/types';

/**
 * Handles `streamz://party/CODE`. A deep link must never become a way around the gate,
 * so the parsed code is held until the session reports an authorized route, and the
 * previous `reset()` straight to Main is gone.
 */
export const PartyLinkHandler = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { decision } = useSession();
  const pendingRef = useRef<string | null>(null);

  const tryOpen = useCallback(
    (code: string) => {
      const authorized = decision === 'ready' || decision === 'offlineCached';
      if (!authorized) {
        pendingRef.current = code;
        return;
      }
      pendingRef.current = null;
      // Watch party is deferred by flag (spec §2): consume the link without routing.
      if (!FEATURES.watchParty) return;
      navigation.navigate('JoinParty', { code });
    },
    [decision, navigation],
  );

  useEffect(() => {
    const open = (url: string | null) => {
      if (!url) return;
      const code = parsePartyCodeFromUrl(url);
      if (code) tryOpen(code);
    };
    void Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', (event) => open(event.url));
    return () => sub.remove();
  }, [tryOpen]);

  useEffect(() => {
    if (pendingRef.current) tryOpen(pendingRef.current);
  }, [tryOpen]);

  return null;
};
