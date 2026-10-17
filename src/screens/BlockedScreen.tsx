import React, { useState } from 'react';
import { Linking, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, CloudOff, ShieldX, MessageCircle, Mail, type LucideIcon } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { StreamZAmbient, StreamZButton, StreamZStateView, StreamZText } from '@/src/components/streamz';
import { BRAND } from '@/src/config/brand';
import { signOut } from '@/src/firebase/auth/googleAuth';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import {
  keyOutcomeMessage,
  keyOutcomeOfGate,
  type KeyState,
} from '@/src/firebase/subscriptions/keyOutcome';

const SUPPORT_SUBJECT = encodeURIComponent(`${BRAND.name} access`);

/**
 * The icon and the heading are this screen's own; the sentence under them is not, and comes
 * from the same mapping as every other key outcome in the app. A state with no heading of its
 * own gets the neutral one — never "Access Revoked", which this screen used to say to anybody
 * it had no verdict for, including someone whose app had merely not finished checking.
 */
const HEADLINES: Partial<Record<KeyState, { icon: LucideIcon; title: string }>> & {
  default: { icon: LucideIcon; title: string };
} = {
  CHECK_UNREACHABLE: { icon: CloudOff, title: 'Waiting for the server' },
  CHECK_PENDING: { icon: CloudOff, title: 'Checking your subscription' },
  CHECK_UNEXPECTED: { icon: CloudOff, title: 'Check did not finish' },
  CHECK_REFUSED: { icon: ShieldX, title: 'Key could not be checked' },
  VERDICT_UNUSABLE: { icon: CloudOff, title: 'Status unavailable' },
  EXPIRED: { icon: Clock, title: 'Subscription Expired' },
  REVOKED: { icon: ShieldX, title: 'Key Revoked' },
  ACCOUNT_SUSPENDED: { icon: ShieldX, title: 'Account Suspended' },
  ACCOUNT_DISABLED: { icon: ShieldX, title: 'Account Disabled' },
  CEILING: { icon: ShieldX, title: 'Device Limit Reached' },
  UNAUTHENTICATED: { icon: ShieldX, title: 'Not Signed In' },
  default: { icon: ShieldX, title: 'Access Not Active' },
};

/**
 * The designed dead ends (PRD §33, §41). A device past its grace window needs a retry, not an
 * apology; an expired key needs renewal; a suspended account needs support. Copy names no SDK,
 * no collection, no internals — and it is the same mapping the activation panel and the Settings
 * account card read from, because this screen used to answer "Access Revoked" to everything,
 * including a check that had not finished yet. A verdict the app does not have is not a revocation.
 */
export const BlockedScreen = () => {
  const insets = useSafeAreaInsets();
  const { decision, access, refresh } = useSession();
  const [retrying, setRetrying] = useState(false);

  const outcome = keyOutcomeOfGate(decision, access);
  const headline = HEADLINES[outcome.state] ?? HEADLINES.default;

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
        <StreamZStateView
          icon={headline.icon}
          title={headline.title}
          message={keyOutcomeMessage(outcome)}
        />

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
