import React, { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { StreamZWordmark } from '@/src/components/StreamZWordmark';
import { BRAND } from '@/src/config/brand';
import { formatKeyInput, looksPlausible } from '@/src/firebase/subscriptions/keyFormat';
import { activate, TransportError } from '@/src/firebase/subscriptions/api';
import { describeActivation } from '@/src/firebase/errors';
import { useSession } from '@/src/firebase/auth/SessionProvider';

const SUPPORT_SUBJECT = encodeURIComponent(`${BRAND.name} subscription`);

export const SubscriptionScreen = () => {
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justActivated, setJustActivated] = useState(false);

  const plausible = useMemo(() => looksPlausible(raw), [raw]);

  const onChange = useCallback((next: string) => {
    setRaw(next);
    setError(null);
  }, []);

  const onActivate = useCallback(async () => {
    if (busy || !plausible) return;
    setBusy(true);
    setError(null);
    try {
      const result = await activate(raw);
      if (result.code === 'ACTIVATED') {
        setJustActivated(true);
        await refresh();
        return;
      }
      setError(describeActivation(result.code));
    } catch (e) {
      setError(
        e instanceof TransportError
          ? "We couldn't verify your subscription. Check your connection and try again."
          : 'Activation failed. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, plausible, raw, refresh]);

  return (
    <Box className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <VStack
          className="flex-1 justify-center px-6"
          space="lg"
          style={{ paddingBottom: insets.bottom + 24, paddingTop: insets.top + 24 }}
        >
          <StreamZWordmark size={34} />

          <VStack space="xs">
            <Heading size="xl" className="text-white">
              Activate your subscription
            </Heading>
            <Text className="text-typography-400">
              Enter the key issued with your {BRAND.name} account to unlock the library.
            </Text>
          </VStack>

          <VStack space="xs">
            <Text size="sm" className="text-typography-300">
              Subscription key
            </Text>
            <Input className="rounded-xl border-border-400">
              <InputField
                value={raw}
                onChangeText={onChange}
                placeholder="FLK-XXXX-XXXX-XXXX"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={20}
                returnKeyType="go"
                onSubmitEditing={() => void onActivate()}
                className="px-4 py-3 text-white"
              />
            </Input>
            {raw.length > 0 ? (
              <Text
                size="xs"
                className={plausible ? 'text-typography-400' : 'text-destructive'}
              >
                {plausible ? 'Ready to activate.' : 'Keep typing — a key is 12 characters after the prefix.'}
              </Text>
            ) : null}
          </VStack>

          {error ? (
            <Text size="sm" className="text-destructive">
              {error}
            </Text>
          ) : null}

          {justActivated ? (
            <Text size="sm" className="text-white">
              Activated. Opening {BRAND.name}…
            </Text>
          ) : (
            <Button
              size="lg"
              isDisabled={busy || !plausible}
              onPress={onActivate}
              className="rounded-xl"
              style={{ backgroundColor: BRAND.accentHex, opacity: plausible ? 1 : 0.5 }}
            >
              {busy ? <ButtonSpinner color="white" /> : null}
              <ButtonText className="text-white">{busy ? 'Checking…' : 'Activate'}</ButtonText>
            </Button>
          )}

          <VStack space="xs">
            <Text size="sm" className="text-typography-400">
              Need a subscription?
            </Text>
            <Pressable
              onPress={() => Linking.openURL(BRAND.supportTelegramUrl)}
              hitSlop={8}
              accessibilityRole="link"
            >
              <Text size="sm" className="text-white underline">
                Chat with support on Telegram {BRAND.supportTelegram}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Linking.openURL(`mailto:${BRAND.supportEmail}?subject=${SUPPORT_SUBJECT}`)
              }
              hitSlop={8}
              accessibilityRole="link"
            >
              <Text size="sm" className="text-white underline">
                Email {BRAND.supportEmail}
              </Text>
            </Pressable>
          </VStack>
        </VStack>
      </KeyboardAvoidingView>
    </Box>
  );
};
