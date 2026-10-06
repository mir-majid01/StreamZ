import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, MessageCircle, Mail } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Input, InputField } from '@/components/ui/input';
import {
  StreamZAmbient,
  StreamZButton,
  StreamZCard,
  StreamZLogo,
  StreamZText,
} from '@/src/components/streamz';
import { BRAND } from '@/src/config/brand';
import { THEME } from '@/src/theme/tokens';
import { formatKeyInput, looksPlausible } from '@/src/firebase/subscriptions/keyFormat';
import { activate, TransportError } from '@/src/firebase/subscriptions/api';
import { AppEvent, logAppEvent } from '@/src/firebase/analytics/appEvents';
import { describeActivation } from '@/src/firebase/errors';
import { useSession } from '@/src/firebase/auth/SessionProvider';

const SUPPORT_SUBJECT = encodeURIComponent(`${BRAND.name} subscription`);

const formatDate = (ms: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
};

/**
 * Activation (PRD §19-§20). The input is grouped live by the canonical key
 * codec — the same grammar the Admin app, the rules and the dormant functions
 * pin — so the UI never invents a second format. The success panel shows only
 * what the server actually returned (real expiry, this installation).
 */
export const SubscriptionScreen = () => {
  const insets = useSafeAreaInsets();
  const { refresh } = useSession();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ expiresAt: number | null } | null>(null);

  const plausible = looksPlausible(raw);

  const onChange = useCallback((next: string) => {
    // Live grouping through the codec: uppercase, prefix handling, 4×5 dashes.
    setRaw(formatKeyInput(next));
    setError(null);
  }, []);

  const onActivate = useCallback(async () => {
    if (busy || !plausible) return;
    setBusy(true);
    setError(null);
    try {
      const result = await activate(raw);
      // The outcome code only. Never the key, not even a hash of it: an analytics event is
      // a copy of its payload into a third-party pipeline.
      logAppEvent(AppEvent.KEY_ACTIVATION, { result: result.code });
      if (result.code === 'ACTIVATED' || result.code === 'ALREADY_OWNED') {
        setActive({ expiresAt: result.expiresAt });
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
  }, [busy, plausible, raw]);

  const onContinue = useCallback(async () => {
    // GateSync advances the stack once the session layer confirms authorized.
    await refresh();
  }, [refresh]);

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
          className="flex-1 justify-center px-6"
          space="xl"
          style={{ paddingBottom: insets.bottom + 24, paddingTop: insets.top + 24 }}
        >
          <VStack space="md" className="items-center">
            <StreamZLogo size={34} />
            <StreamZText variant="screenTitle" className="text-center text-foreground">
              Unlock {BRAND.name}
            </StreamZText>
            <StreamZText variant="secondary" className="text-center text-muted-foreground">
              Your subscription gives you access to the full application.
            </StreamZText>
          </VStack>

          {active ? (
            <VStack space="lg" className="items-center">
              <CheckCircle2 size={44} color={THEME.success} />
              <StreamZText variant="sectionTitle" className="text-foreground">
                Subscription Active
              </StreamZText>
              {active.expiresAt ? (
                <StreamZText variant="body" className="text-muted-foreground">
                  Expires {formatDate(active.expiresAt)}
                </StreamZText>
              ) : null}
              <StreamZText variant="secondary" className="text-muted-foreground">
                Device · This installation
              </StreamZText>
              <StreamZButton
                label="Continue to StreamZ"
                onPress={onContinue}
                className="mt-2 w-full"
              />
            </VStack>
          ) : (
            <>
              <StreamZCard>
                <VStack space="md">
                  <StreamZText variant="caption" className="text-muted-foreground">
                    Subscription key
                  </StreamZText>
                  <Box className="rounded-xl border border-input bg-secondary">
                    <Input className="border-0 bg-transparent" isFocused={false}>
                      <InputField
                        value={raw}
                        onChangeText={onChange}
                        placeholder="SZ-XXXXX-XXXXX-XXXXX-XXXXX"
                        placeholderTextColor="#4A4A52"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        maxLength={28}
                        returnKeyType="go"
                        submitBehavior="submit"
                        onSubmitEditing={() => void onActivate()}
                        className="px-4 py-3.5 text-[15px] tracking-[1.2px] text-foreground"
                        aria-label="Subscription key"
                      />
                    </Input>
                  </Box>
                  {raw.length > 0 ? (
                    <StreamZText variant="metadata" className={plausible ? 'text-muted-foreground' : 'text-destructive'}>
                      {plausible
                        ? 'Ready to activate.'
                        : 'Keep typing — a key is 4 groups of 5 characters.'}
                    </StreamZText>
                  ) : (
                    <StreamZText variant="metadata" className="text-muted-foreground">
                      Formatted automatically as you type, with or without the SZ- prefix.
                    </StreamZText>
                  )}
                </VStack>
              </StreamZCard>

              {error ? (
                <StreamZText variant="secondary" className="text-center text-destructive">
                  {error}
                </StreamZText>
              ) : null}

              <StreamZButton
                label={busy ? 'Checking…' : 'Activate'}
                loading={busy}
                disabled={!plausible}
                onPress={onActivate}
              />

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
                  onPress={() =>
                    Linking.openURL(`mailto:${BRAND.supportEmail}?subject=${SUPPORT_SUBJECT}`)
                  }
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
            </>
          )}
        </VStack>
      </KeyboardAvoidingView>
    </Box>
  );
};
