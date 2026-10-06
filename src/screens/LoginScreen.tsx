import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2 } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import {
  GoogleG,
  StreamZAmbient,
  StreamZButton,
  StreamZLogo,
  StreamZText,
} from '@/src/components/streamz';
import { BRAND } from '@/src/config/brand';
import { THEME } from '@/src/theme/tokens';
import { signInWithGoogle } from '@/src/firebase/auth/googleAuth';
import { AppEvent, logAppEvent } from '@/src/firebase/analytics/appEvents';
import { useSession } from '@/src/firebase/auth/SessionProvider';

/**
 * Sign-in only. Navigation after success is driven by SessionProvider, never by this
 * screen, so there is exactly one place that decides what a signed-in user sees.
 * The button reflects only real states (PRD §4): idle, connecting, signed-in,
 * or the human-readable failure from describeAuthError.
 */
export const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    if (busy || signedIn) return;
    setBusy(true);
    setError(null);
    const result = await signInWithGoogle();
    if (result.kind === 'error') {
      setBusy(false);
      setError(result.message);
      return;
    }
    if (result.kind === 'success') {
      logAppEvent(AppEvent.SIGN_IN, { method: 'google' });
      setSignedIn(true);
      await refresh();
      setBusy(false);
    }
    // 'cancelled' falls through: the button simply returns to idle.
    setBusy(false);
  };

  return (
    <Box className="flex-1 bg-background">
      <Box className="absolute inset-0" pointerEvents="none">
        <StreamZAmbient />
      </Box>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <VStack
          className="flex-1 justify-center px-8"
          space="xl"
          style={{ paddingBottom: insets.bottom + 24, paddingTop: insets.top + 24 }}
        >
          <VStack space="md" className="items-center">
            <StreamZLogo size={40} />
            <StreamZText variant="hero" className="text-center text-foreground">
              Welcome to {BRAND.name}
            </StreamZText>
            <StreamZText variant="secondary" className="text-center text-muted-foreground">
              {BRAND.tagline}
            </StreamZText>
          </VStack>

          <Box className="mt-6">
            {signedIn ? (
              <StreamZButton
                variant="outline"
                icon={<CheckCircle2 size={20} color={THEME.success} />}
                label="Signed in"
                disabled
              />
            ) : (
              <StreamZButton
                variant="google"
                icon={<GoogleG size={20} />}
                label={busy ? 'Connecting…' : 'Continue with Google'}
                loading={busy}
                onPress={onSignIn}
              />
            )}
            {error ? (
              <StreamZText variant="secondary" className="mt-4 text-center text-destructive">
                {error}
              </StreamZText>
            ) : null}
          </Box>

          <VStack space="xs" className="items-center">
            <StreamZText variant="metadata" className="text-center text-muted-foreground">
              Secure authentication — your account is protected by Google
            </StreamZText>
            <StreamZText variant="metadata" className="text-center text-muted-foreground">
              An account and an active subscription key are required to continue.
            </StreamZText>
          </VStack>
        </VStack>
      </KeyboardAvoidingView>
    </Box>
  );
};
