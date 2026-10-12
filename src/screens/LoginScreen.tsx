import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Lock } from 'lucide-react-native';
import {
  AnimatedStreamZZMark,
  AuthBackdrop,
  AuthCta,
  AuthLead,
  AuthTitle,
  GoogleG,
  RiseIn,
  StreamZText,
  usePrefersReducedMotion,
} from '@/src/components/streamz';
import { AUTH, BORDER_COLOR, FONT } from '@/src/theme/tokens';
import { signInWithGoogle } from '@/src/firebase/auth/googleAuth';
import { AppEvent, logAppEvent } from '@/src/firebase/analytics/appEvents';
import { useSession } from '@/src/firebase/auth/SessionProvider';

/**
 * Sign-in (flow screen 1). Navigation after success is driven by SessionProvider,
 * never by this screen, so exactly one place decides what a signed-in user sees.
 * The button therefore carries only real states — idle, connecting, signed in, or
 * the human-readable failure from signInWithGoogle — and the entrance choreography
 * is presentation, never a gate on those states.
 *
 * The mockup's "Terms and Privacy Policy" links are left out: the app has neither
 * destination, and a consent line pointing at nothing is worse than no line.
 */
export const LoginScreen = () => {
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
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
    <View style={styles.root}>
      <AuthBackdrop anchor="high" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 30 },
        ]}
      >
        <View style={styles.identity}>
          <LinearGradient colors={['#1A1A1F', '#0C0C0F']} style={styles.markBox}>
            <AnimatedStreamZZMark size={60} delay={250} reduced={reduced} />
          </LinearGradient>
          <RiseIn delay={900} reduced={reduced}>
            <StreamZText style={styles.wordmark}>
              Stream
              <Text style={styles.wordmarkAccent}>Z</Text>
            </StreamZText>
          </RiseIn>
          <RiseIn delay={1050} reduced={reduced}>
            <StreamZText style={styles.tagline}>PRIVATE STREAMING</StreamZText>
          </RiseIn>
        </View>

        <View style={styles.spacer} />

        <RiseIn delay={1200} reduced={reduced}>
          <AuthTitle style={styles.headline}>Sign in to continue</AuthTitle>
          <AuthLead>
            Use your Google account to sync your library and subscription across every device.
          </AuthLead>
        </RiseIn>

        <RiseIn delay={1350} reduced={reduced} style={styles.action}>
          <AuthCta
            label={signedIn ? 'Signed in' : busy ? 'Connecting…' : 'Continue with Google'}
            state={signedIn ? 'done' : busy ? 'busy' : 'idle'}
            tone="google"
            onPress={() => void onSignIn()}
            reduced={reduced}
            icon={
              signedIn ? <Check size={20} color="#1B1B1F" /> : <GoogleG size={22} />
            }
          />
          {error ? <StreamZText style={styles.error}>{error}</StreamZText> : null}
        </RiseIn>

        <RiseIn delay={1500} reduced={reduced} style={styles.assurance}>
          <Lock size={14} color={AUTH.dim} />
          <StreamZText style={styles.assuranceLabel}>We only read your name and email.</StreamZText>
        </RiseIn>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AUTH.ink },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  identity: { marginTop: 108, alignItems: 'center' },
  markBox: {
    width: 92,
    height: 92,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: BORDER_COLOR.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    marginTop: 22,
    fontFamily: FONT.display,
    fontSize: 30,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  wordmarkAccent: {
    fontFamily: FONT.display,
    fontSize: 30,
    letterSpacing: -0.6,
    color: AUTH.alert,
  },
  tagline: {
    marginTop: 10,
    fontFamily: FONT.sansMedium,
    fontSize: 11,
    letterSpacing: 2.6,
    color: AUTH.dim,
    textAlign: 'center',
  },
  spacer: { flex: 1, minHeight: 40 },
  // The sign-in headline is set one step below the flow's default: the mockup
  // uses 30px here and 32px on the subscription screens.
  headline: { fontSize: 30, lineHeight: 33, letterSpacing: -0.6, marginBottom: 12 },
  action: { marginTop: 28 },
  error: {
    marginTop: 16,
    textAlign: 'center',
    fontFamily: FONT.sans,
    fontSize: 13,
    lineHeight: 19,
    color: AUTH.alertText,
  },
  assurance: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  assuranceLabel: { fontFamily: FONT.sans, fontSize: 13, color: AUTH.dim },
});
