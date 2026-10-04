import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { StreamZWordmark } from '@/src/components/StreamZWordmark';
import { BRAND } from '@/src/config/brand';
import { signOut } from '@/src/firebase/auth/googleAuth';
import { useSession } from '@/src/firebase/auth/SessionProvider';

/**
 * Two different dead ends. A revoked or expired subscription needs support; a device that
 * simply cannot reach the server past its grace window needs a retry, not an apology.
 */
export const BlockedScreen = () => {
  const insets = useSafeAreaInsets();
  const { decision, access, refresh } = useSession();
  const offline = decision === 'needsServerContact';

  return (
    <Box className="flex-1 bg-background">
      <VStack
        className="flex-1 justify-center px-6"
        space="lg"
        style={{ paddingBottom: insets.bottom + 24, paddingTop: insets.top + 24 }}
      >
        <StreamZWordmark size={28} />
        <VStack space="xs">
          <Heading size="xl" className="text-white">
            {offline ? 'Cannot reach the subscription server' : 'Subscription unavailable'}
          </Heading>
          <Text className="text-typography-400">
            {offline
              ? `${BRAND.name} needs to contact its server before it can open your library. Check your connection and try again.`
              : access?.status === 'expired'
                ? 'This subscription key has expired. Contact support to renew it.'
                : 'This subscription is no longer active on this account. Contact support if you believe this is a mistake.'}
          </Text>
        </VStack>

        <Button
          size="lg"
          onPress={() => void refresh()}
          className="rounded-xl"
          style={{ backgroundColor: BRAND.accentHex }}
        >
          <ButtonText className="text-white">Try again</ButtonText>
        </Button>

        <Button
          variant="outline"
          onPress={() => void signOut()}
          className="rounded-xl"
        >
          <ButtonText>Sign out</ButtonText>
        </Button>

        <Text size="sm" className="text-typography-400">
          Support: {BRAND.supportEmail} · Telegram {BRAND.supportTelegram}
        </Text>
      </VStack>
    </Box>
  );
};
