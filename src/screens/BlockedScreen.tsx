import React, { useState } from 'react';
import { Linking, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, CloudOff, ShieldX, MessageCircle, Mail } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { StreamZAmbient, StreamZButton, StreamZStateView, StreamZText } from '@/src/components/streamz';
import { BRAND } from '@/src/config/brand';
import { signOut } from '@/src/firebase/auth/googleAuth';
import { useSession } from '@/src/firebase/auth/SessionProvider';

const SUPPORT_SUBJECT = encodeURIComponent(`${BRAND.name} access`);

/**
 * The designed dead ends (PRD §33, §41). A device past its grace window needs a
 * retry, not an apology; an expired key needs renewal; anything else negative
 * means the account itself was refused. Copy names no SDK, no collection, no
 * internals — the state is the message.
 */
export const BlockedScreen = () => {
  const insets = useSafeAreaInsets();
  const { decision, access, refresh } = useSession();
  const [retrying, setRetrying] = useState(false);
  const offline = decision === 'needsServerContact';

  const onRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    await refresh();
    setRetrying(false);
  };

  return (
    <Box className="flex-1 bg-background">
      <Box className="absolute inset-0" pointerEvents="none">
        <StreamZAmbient intensity={0.6} />
      </Box>
      <VStack
        className="flex-1 px-6"
        space="md"
        style={{ paddingBottom: insets.bottom + 24, paddingTop: insets.top + 24 }}
      >
        {offline ? (
          <StreamZStateView
            icon={CloudOff}
            title="You're offline"
            message={`${BRAND.name} needs to reach its server before it can open your library. Check your connection and try again.`}
          />
        ) : access?.status === 'expired' ? (
          <StreamZStateView
            icon={Clock}
            title="Subscription Expired"
            message="Your subscription has run out. Enter a new key or contact support to renew."
          />
        ) : (
          <StreamZStateView
            icon={ShieldX}
            title="Access Revoked"
            message="This subscription is no longer active on this account. Contact support if you believe this is a mistake."
          />
        )}

        <VStack space="sm" className="px-8">
          <StreamZButton
            label={retrying ? 'Checking…' : 'Try again'}
            loading={retrying}
            onPress={onRetry}
          />
          <StreamZButton variant="ghost" label="Sign out" onPress={() => void signOut()} />
        </VStack>

        <HStack space="xl" className="items-center justify-center">
          <Pressable
            onPress={() => Linking.openURL(BRAND.supportTelegramUrl)}
            hitSlop={8}
            accessibilityRole="link"
            className="flex-row items-center"
          >
            <MessageCircle size={16} className="mr-2 text-muted-foreground" />
            <StreamZText variant="secondary" className="text-muted-foreground">
              {BRAND.supportTelegram}
            </StreamZText>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(`mailto:${BRAND.supportEmail}?subject=${SUPPORT_SUBJECT}`)}
            hitSlop={8}
            accessibilityRole="link"
            className="flex-row items-center"
          >
            <Mail size={16} className="mr-2 text-muted-foreground" />
            <StreamZText variant="secondary" className="text-muted-foreground">
              {BRAND.supportEmail}
            </StreamZText>
          </Pressable>
        </HStack>
      </VStack>
    </Box>
  );
};
