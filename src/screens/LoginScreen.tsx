import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { StreamZWordmark } from '@/src/components/StreamZWordmark';
import { BRAND } from '@/src/config/brand';
import { signInWithGoogle } from '@/src/firebase/auth/googleAuth';
import { useSession } from '@/src/firebase/auth/SessionProvider';

/**
 * Sign-in only. Navigation after success is driven by SessionProvider, never by this
 * screen, so there is exactly one place that decides what a signed-in user sees.
 */
export const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signInWithGoogle();
    setBusy(false);
    if (result.kind === 'error') setError(result.message);
    if (result.kind === 'success') await refresh();
  };

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
          <StreamZWordmark size={40} />
          <VStack space="xs">
            <Heading size="2xl" className="text-white">
              Welcome to {BRAND.name}
            </Heading>
            <Text className="text-typography-400">{BRAND.tagline}</Text>
          </VStack>

          <Button
            size="lg"
            isDisabled={busy}
            onPress={onSignIn}
            className="rounded-xl"
            style={{ backgroundColor: BRAND.accentHex }}
          >
            {busy ? <ButtonSpinner color="white" /> : null}
            <ButtonText className="text-white">
              {busy ? 'Signing in…' : 'Continue with Google'}
            </ButtonText>
          </Button>

          {error ? (
            <Text size="sm" className="text-destructive">
              {error}
            </Text>
          ) : null}

          <Text size="xs" className="text-typography-500">
            An account and an active subscription key are required to continue.
          </Text>
        </VStack>
      </KeyboardAvoidingView>
    </Box>
  );
};
