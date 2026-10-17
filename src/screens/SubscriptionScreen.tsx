import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { timeLeftParts } from '@/src/utils/subscriptionTerms';
import {
  ArrowRight,
  ChevronLeft,
  KeyRound,
  LoaderCircle,
  Mail,
  Send,
  ShieldCheck,
} from 'lucide-react-native';
import { Input, InputField } from '@/components/ui/input';
import {
  AuthBackdrop,
  AuthCta,
  AuthKicker,
  AuthLead,
  AuthPanel,
  AuthPillLink,
  AuthTitle,
  RiseIn,
  SegmentMeters,
  StreamZPressable,
  StreamZText,
  StreamZWordmark,
  StreamZZMark,
  SuccessSeal,
  usePrefersReducedMotion,
} from '@/src/components/streamz';
import { BRAND } from '@/src/config/brand';
import { AUTH, FONT, MARK_RAMP, SPACE } from '@/src/theme/tokens';
import { formatKeyInput, looksPlausible, normalizeKeyBody } from '@/src/firebase/subscriptions/keyFormat';
import { activate } from '@/src/firebase/subscriptions/api';
import { AppEvent, logAppEvent } from '@/src/firebase/analytics/appEvents';
import {
  keyOutcomeMessage,
  keyOutcomeOfActivateResult,
  keyOutcomeOfThrown,
} from '@/src/firebase/subscriptions/keyOutcome';
import { DAY_MS, type AccessResult } from '@/src/firebase/models';
import { useSession } from '@/src/firebase/auth/SessionProvider';
import { signOut } from '@/src/firebase/auth/googleAuth';

const KEY_BODY_LENGTH = 20;

/** The design's sweep curve, shared by the meters and the remaining-term bar. */
const BAR_CURVE = Easing.bezier(0.3, 0.7, 0.2, 1);

const SUPPORT_SUBJECT = encodeURIComponent(`${BRAND.name} subscription`);

const formatDate = (ms: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleDateString();
  }
};

type FieldTone = 'idle' | 'error' | 'done';

type Activated = {
  expiresAt: number | null;
  durationDays: number | null;
  /**
   * The key's own term in milliseconds. The meter and the "time left" line are
   * measured against this, so a four-minute key is not drawn as a nearly-empty
   * day-long bar the second it activates.
   */
  durationMs: number | null;
};

/**
 * Activation and the confirmation that follows (flow screens 2 and 3).
 *
 * The input is grouped live by the canonical key codec — the same grammar the
 * Admin app and the Firestore rules pin — so the UI never invents a second
 * format. Every number on the success panel is one the server returned: expiry,
 * days left, and the meter all come from `expiresAt` and the key's own duration,
 * never from a sample value.
 */
export const SubscriptionScreen = () => {
  const insets = useSafeAreaInsets();
  const reduced = usePrefersReducedMotion();
  const { user, access, refresh } = useSession();
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const [active, setActive] = useState<Activated | null>(null);

  const entered = Math.min(
    KEY_BODY_LENGTH,
    normalizeKeyBody(raw) ? KEY_BODY_LENGTH : raw.replace(/[^A-Z0-9]/g, '').length,
  );
  const plausible = looksPlausible(raw);
  const tone: FieldTone = error ? 'error' : active ? 'done' : 'idle';

  const onChange = useCallback((next: string) => {
    setRaw(formatKeyInput(next));
    setError(null);
  }, []);

  const onActivate = useCallback(async () => {
    if (busy || !plausible) {
      if (!plausible) setRefusals((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await activate(raw);
      // The outcome code only. Never the key, not even a hash of it: an analytics
      // event is a copy of its payload into a third-party pipeline.
      logAppEvent(AppEvent.KEY_ACTIVATION, { result: result.code });
      if (result.code === 'ACTIVATED' || result.code === 'ALREADY_OWNED') {
        setActive({
          expiresAt: result.expiresAt,
          durationDays: result.durationDays,
          durationMs: result.durationMs,
        });
        return;
      }
      // Every refusal, and only a refusal, goes through the one key-outcome mapping. The
      // EXPIRED result carries the expiry the key document stated, which is what lets the
      // same line say how long ago that was — or stay silent when the document had none.
      setError(keyOutcomeMessage(keyOutcomeOfActivateResult(result)));
      setRefusals((n) => n + 1);
    } catch (e) {
      // A thrown value is not evidence about the key. It is either the transport failing
      // (worth retrying, nothing learned), the rules refusing to answer (a real refusal, but a
      // refusal to *read*, not a verdict on the key), or something unrecognised. All three say
      // the check did not complete and offer a retry; none of them may borrow "invalid key".
      setError(keyOutcomeMessage(keyOutcomeOfThrown(e)));
      setRefusals((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, plausible, raw]);

  const onContinue = useCallback(async () => {
    // GateSync advances the stack once the session layer confirms authorized.
    await refresh();
  }, [refresh]);

  if (active) {
    return (
      <ActivatedPanel
        active={active}
        access={access}
        reduced={reduced}
        insets={insets}
        onContinue={onContinue}
      />
    );
  }

  const help = error
    ? error
    : plausible
      ? 'Ready to activate.'
      : raw.length > 0
        ? `${entered} of ${KEY_BODY_LENGTH} characters`
        : 'Formatted automatically as you type, with or without the SZ- prefix.';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AuthBackdrop anchor="low" />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 30 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <StreamZPressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={8}
            style={styles.back}
          >
            <ChevronLeft size={18} color="#FFFFFF" />
          </StreamZPressable>
          <StreamZZMark size={34} />
          <View style={styles.topBarSpacer} />
        </View>

        {user ? (
          <RiseIn delay={100} reduced={reduced} style={styles.chipRow}>
            <View style={styles.chip}>
              <ShieldCheck size={16} color={AUTH.muted} />
              <StreamZText style={styles.chipLabel}>Signed in with Google</StreamZText>
              <View style={styles.chipDot} />
            </View>
          </RiseIn>
        ) : null}

        <RiseIn delay={200} reduced={reduced} style={styles.heading}>
          <AuthKicker>STEP 2 OF 2</AuthKicker>
          <AuthTitle>Unlock {BRAND.name}</AuthTitle>
          <AuthLead>Enter the subscription key you received to activate full access.</AuthLead>
        </RiseIn>

        <RiseIn delay={350} reduced={reduced}>
          <AuthPanel>
            <StreamZText style={styles.fieldLabel}>Subscription key</StreamZText>
            <KeyField
              value={raw}
              tone={tone}
              focused={focused}
              refusals={refusals}
              reduced={reduced}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={onChange}
              onSubmit={() => void onActivate()}
            />
            <SegmentMeters entered={entered} tone={tone} reduced={reduced} />
            <StreamZText
              style={[
                styles.help,
                tone === 'error' && styles.helpError,
                tone === 'done' && styles.helpDone,
              ]}
              accessibilityLiveRegion="polite"
            >
              {help}
            </StreamZText>
          </AuthPanel>
        </RiseIn>

        <RiseIn delay={500} reduced={reduced} style={styles.footer}>
          <AuthCta
            label={busy ? 'Verifying' : error ? 'Try again' : 'Activate'}
            state={busy ? 'busy' : 'idle'}
            onPress={() => void onActivate()}
            disabled={!plausible}
            reduced={reduced}
            icon={busy ? <LoaderCircle size={20} color="#FFFFFF" /> : undefined}
          />

          <View style={styles.support}>
            <StreamZText style={styles.supportLabel}>NEED A KEY?</StreamZText>
            <View style={styles.supportRow}>
              <AuthPillLink
                label={BRAND.supportTelegram}
                icon={<Send size={16} color={AUTH.alert} />}
                onPress={() => void Linking.openURL(BRAND.supportTelegramUrl)}
              />
              <AuthPillLink
                label={BRAND.supportEmail}
                icon={<Mail size={16} color={AUTH.alert} />}
                onPress={() =>
                  void Linking.openURL(`mailto:${BRAND.supportEmail}?subject=${SUPPORT_SUBJECT}`)
                }
              />
            </View>
          </View>
        </RiseIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

/**
 * The field and its refusal shake. Focus is tracked in state rather than styled,
 * because native has no `:focus-within`; the ring is a real 4px border rather
 * than a box-shadow so it renders identically on both platforms. Border colour
 * is the same signal as the help line below it, so the two can never disagree.
 */
const KeyField = ({
  value,
  tone,
  focused,
  refusals,
  reduced,
  onFocus,
  onBlur,
  onChange,
  onSubmit,
}: {
  value: string;
  tone: FieldTone;
  focused: boolean;
  refusals: number;
  reduced: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (next: string) => void;
  onSubmit: () => void;
}) => {
  const shake = useSharedValue(0);

  useEffect(() => {
    if (refusals === 0 || reduced) return;
    shake.value = 0;
    shake.value = withSequence(
      withTiming(-7, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(6, { duration: 90 }),
      withTiming(-4, { duration: 90 }),
      withTiming(3, { duration: 90 }),
      withTiming(0, { duration: 90 }),
    );
  }, [refusals, reduced, shake]);

  const animated = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const borderColor =
    tone === 'error' ? AUTH.alert : tone === 'done' ? AUTH.success : focused ? AUTH.alert : AUTH.edge;

  return (
    <Animated.View style={[styles.fieldRing, tone !== 'error' && focused && styles.fieldRingFocus, animated]}>
      <View style={[styles.field, { borderColor }]}>
        <KeyRound size={20} color="#8B8B94" />
        <Input className="h-full min-w-0 flex-1 border-0 bg-transparent p-0" isFocused={false}>
          <InputField
            value={value}
            onChangeText={onChange}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            placeholderTextColor="#55555E"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            maxLength={28}
            returnKeyType="go"
            submitBehavior="submit"
            onSubmitEditing={onSubmit}
            style={styles.keyInput}
            aria-label="Subscription key"
          />
        </Input>
      </View>
    </Animated.View>
  );
};

/**
 * The confirmation screen. Nothing here is invented: the days, the expiry and
 * the meter all derive from the expiry the server wrote. If the term's length
 * is unknown the meter is omitted rather than drawn full, because a full bar
 * would claim nothing had been used.
 */
const ActivatedPanel = ({
  active,
  access,
  reduced,
  insets,
  onContinue,
}: {
  active: Activated;
  access: AccessResult | null;
  reduced: boolean;
  insets: ReturnType<typeof useSafeAreaInsets>;
  onContinue: () => Promise<void>;
}) => {
  // Server time when we have it: a device clock a few minutes fast would
  // otherwise show one day fewer than the term actually grants.
  const now = access?.serverTimeMs ?? Date.now();
  const remainingMs = active.expiresAt ? active.expiresAt - now : null;
  const timeLeft = remainingMs != null ? timeLeftParts(remainingMs) : null;
  const termMs =
    active.durationMs ?? (active.durationDays != null ? active.durationDays * DAY_MS : null);
  const ratio =
    active.expiresAt != null && termMs != null && termMs > 0
      ? Math.min(1, Math.max(0, (active.expiresAt - now) / termMs))
      : null;

  // The bar arrives at 1s, sweeping on scaleX so the animation never relayouts a
  // width. Same design curve as the key-entry meters, same 4px height.
  const sweep = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      sweep.value = 1;
      return;
    }
    sweep.value = withDelay(1000, withTiming(1, { duration: 1000, easing: BAR_CURVE }));
  }, [reduced, sweep]);
  const barSweep = useAnimatedStyle(() => ({ transform: [{ scaleX: sweep.value }] }));

  return (
    <View style={styles.root}>
      <AuthBackdrop anchor="high" />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 30 },
        ]}
      >
        <RiseIn delay={0} reduced={reduced} style={styles.activeTop}>
          <StreamZWordmark size={20} />
        </RiseIn>

        <RiseIn delay={reduced ? 0 : 900} reduced={reduced} style={styles.sealRow}>
          <SuccessSeal reduced={reduced} />
        </RiseIn>

        <RiseIn delay={reduced ? 0 : 900} reduced={reduced} style={styles.activeHeading}>
          <AuthTitle style={styles.centered}>Subscription active</AuthTitle>
          <AuthLead>Full access is unlocked on this device.</AuthLead>
        </RiseIn>

        <RiseIn delay={reduced ? 0 : 1050} reduced={reduced} style={styles.card}>
          <AuthPanel>
            <View style={styles.statRow}>
              <View>
                <StreamZText style={styles.statLabel}>TIME LEFT</StreamZText>
                {timeLeft ? (
                  <StreamZText style={styles.statValue}>
                    {timeLeft.value}{' '}
                    <StreamZText style={styles.statUnit}>{timeLeft.unit}</StreamZText>
                  </StreamZText>
                ) : null}
              </View>
              {remainingMs != null && remainingMs > 0 ? (
                <View style={styles.badge}>
                  <View style={styles.badgeDot} />
                  <StreamZText style={styles.badgeLabel}>Active</StreamZText>
                </View>
              ) : null}
            </View>

            {ratio != null ? (
              <View style={styles.barTrack}>
                <Animated.View style={[styles.barFill, { width: `${ratio * 100}%` }, barSweep]}>
                  <LinearGradient
                    colors={[MARK_RAMP.bright, MARK_RAMP.deep]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              </View>
            ) : null}

            <View style={styles.rows}>
              {active.expiresAt ? (
                <View style={styles.row}>
                  <StreamZText style={styles.rowLabel}>Expires</StreamZText>
                  <StreamZText style={styles.rowValue}>{formatDate(active.expiresAt)}</StreamZText>
                </View>
              ) : null}
              <View style={styles.row}>
                <StreamZText style={styles.rowLabel}>Device</StreamZText>
                <StreamZText style={styles.rowValue}>This installation</StreamZText>
              </View>
            </View>
          </AuthPanel>
        </RiseIn>

        <View style={styles.spacer} />

        <RiseIn delay={reduced ? 0 : 1200} reduced={reduced} style={styles.activeFooter}>
          <AuthCta
            label="Continue to StreamZ"
            onPress={() => void onContinue()}
            reduced={reduced}
            trailing={<ArrowRight size={20} color="#FFFFFF" />}
          />
        </RiseIn>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: AUTH.ink },
  scrollContent: { paddingHorizontal: 24, flexGrow: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topBarSpacer: { width: 44 },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AUTH.rail,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { marginTop: 34 },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 10,
    paddingRight: 14,
    borderRadius: 22,
    backgroundColor: AUTH.chip,
    borderWidth: 1,
    borderColor: AUTH.edge,
  },
  chipLabel: { fontFamily: FONT.sansMedium, fontSize: 13, color: '#C9C9D1' },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AUTH.success },
  heading: { marginTop: 34, gap: SPACE.md },
  fieldLabel: { fontFamily: FONT.sansMedium, fontSize: 13, color: AUTH.muted },
  fieldRing: { marginTop: 12, borderRadius: 22, borderWidth: 4, borderColor: 'transparent' },
  fieldRingFocus: { borderColor: 'rgba(255,59,82,0.16)' },
  field: {
    height: 60,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: AUTH.field,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  keyInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    fontFamily: FONT.mono,
    fontSize: 15,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  help: {
    marginTop: 14,
    minHeight: 20,
    fontFamily: FONT.sans,
    fontSize: 13,
    lineHeight: 18,
    color: AUTH.faint,
  },
  helpError: { color: AUTH.alertText },
  helpDone: { color: AUTH.success },
  footer: { marginTop: 34, gap: 26 },
  support: { alignItems: 'center', gap: SPACE.md },
  supportLabel: { fontFamily: FONT.sansMedium, fontSize: 12, letterSpacing: 1.7, color: AUTH.faint },
  supportRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  activeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  sealRow: { alignItems: 'center', marginTop: 78 },
  activeHeading: { marginTop: 30, alignItems: 'center', gap: SPACE.md },
  centered: { textAlign: 'center' },
  card: { marginTop: 34 },
  statRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  statLabel: { fontFamily: FONT.sansSemiBold, fontSize: 11, letterSpacing: 2.2, color: AUTH.faint },
  statValue: {
    marginTop: 8,
    fontFamily: FONT.displayMedium,
    fontSize: 34,
    lineHeight: 34,
    letterSpacing: -0.7,
    color: '#FFFFFF',
  },
  statUnit: { fontSize: 16, fontWeight: '500', letterSpacing: 0, color: AUTH.muted },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: AUTH.badgeGreenBg,
    borderWidth: 1,
    borderColor: AUTH.badgeGreenEdge,
  },
  badgeLabel: { fontFamily: FONT.sansSemiBold, fontSize: 12, color: AUTH.success },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: AUTH.success },
  barTrack: {
    marginTop: 16,
    height: 4,
    borderRadius: 2,
    backgroundColor: AUTH.track,
    overflow: 'hidden',
  },
  barFill: { height: 4, borderRadius: 2, transformOrigin: '0% 50%' },
  rows: { marginTop: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: AUTH.rowDivider,
  },
  rowLabel: { fontFamily: FONT.sans, fontSize: 14, color: AUTH.faint },
  rowValue: { fontFamily: FONT.sansMedium, fontSize: 14, color: '#FFFFFF' },
  spacer: { flex: 1, minHeight: 40 },
  activeFooter: { marginTop: 34 },
});
