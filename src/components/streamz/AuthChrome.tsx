import React, { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { StreamZPressable } from './StreamZPressable';
import { StreamZText } from './StreamZText';
import { AUTH, FONT, MARK_RAMP } from '@/src/theme/tokens';

/**
 * Shared chrome for the sign-in and subscription flow, built against the auth
 * design system. That palette is deliberately narrower than the app theme — a
 * blacker ink, a brighter accent, DM Sans instead of Inter — so it lives in the
 * AUTH token block and inline styles rather than in global.css, where it would
 * read as an app-wide theme nothing else follows.
 *
 * Everything two or more of those screens share is here, so they cannot drift.
 */

const RISE_CURVE = Easing.bezier(0.2, 0.7, 0.2, 1);
const METER_CURVE = Easing.bezier(0.3, 0.7, 0.2, 1);

/**
 * react-native-svg has no `pathLength` — it is a web-only attribute — so the seal's
 * draw-on runs on measured geometry instead: the ring's circumference and the tick's
 * two segment lengths. Each dash is set slightly long so the stroke is fully hidden
 * at offset = length.
 */
const SEAL_RING_LENGTH = 2 * Math.PI * 40;
const SEAL_TICK_LENGTH = 50;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The OS reduce-motion setting, read once then tracked. Every animation here
 * degrades to its finished state when it is on, matching the reduced-motion
 * block the mockups ship.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** One red bloom at the top-left over the ink, and a scrim lifting the bottom. */
export const AuthBackdrop = ({ anchor = 'high' }: { anchor?: 'high' | 'low' }) => (
  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <View style={styles.ink} />
    <Svg style={StyleSheet.absoluteFill} accessible={false}>
      <Defs>
        <RadialGradient id="authBloom" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={AUTH.ctaTop} stopOpacity={anchor === 'high' ? 0.3 : 0.26} />
          <Stop offset="0.72" stopColor={AUTH.ctaTop} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect
        x={anchor === 'high' ? -70 : -60}
        y={anchor === 'high' ? -150 : -170}
        width={anchor === 'high' ? 530 : 540}
        height={anchor === 'high' ? 530 : 540}
        fill="url(#authBloom)"
      />
    </Svg>
    <LinearGradient
      colors={['rgba(5,3,4,0)', '#050304']}
      locations={[0, 0.72]}
      style={styles.scrim}
    />
  </View>
);

/**
 * Entrance: a rise plus a fade on the design's curve, staggered by `delay`. A
 * screen wraps its blocks in this to sequence a reveal without any child having
 * to know the timeline. The defaults are the auth flow's travel and duration;
 * other mockups specify their own, so `distance`/`duration` can override them.
 */
export const RiseIn = ({
  delay = 0,
  distance = 16,
  duration = 750,
  reduced = false,
  children,
  style,
}: {
  delay?: number;
  /** Travel in px; the mockups specify 14–16 depending on the screen. */
  distance?: number;
  duration?: number;
  reduced?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => {
  const shown = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      shown.value = 1;
      return;
    }
    shown.value = withDelay(delay, withTiming(1, { duration, easing: RISE_CURVE }));
  }, [shown, delay, duration, reduced]);

  const animated = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: (1 - shown.value) * distance }],
  }));

  return <Animated.View style={[animated, style]}>{children}</Animated.View>;
};

/** The card face the flow shares: two-stop surface, one hairline, 24 radius. */
export const AuthPanel = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) => (
  <LinearGradient colors={[AUTH.surfaceTop, AUTH.surfaceBottom]} style={[styles.panel, style]}>
    {children}
  </LinearGradient>
);

export type AuthCtaState = 'idle' | 'busy' | 'done';

/**
 * The flow's primary action: the red ramp, a travelling highlight, three honest
 * states. `done` turns green and only ever reports something the server actually
 * confirmed; callers reset it rather than parking the button on success.
 *
 * `tone="google"` exists because Google's brand rules require the sign-in button
 * to be white with a dark label — an accent-gradient override would fail their
 * guidelines, so the surface is swapped rather than layered over.
 */
export const AuthCta = ({
  label,
  state = 'idle',
  onPress,
  disabled,
  icon,
  trailing,
  tone = 'accent',
  reduced = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  state?: AuthCtaState;
  onPress: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  /** Right-hand content, e.g. the arrow on "Continue to StreamZ". */
  trailing?: React.ReactNode;
  tone?: 'accent' | 'google';
  reduced?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) => {
  const isDone = state === 'done' && tone !== 'google';
  const busy = state === 'busy';
  const blocked = disabled === true || busy || isDone;
  const sheen = useSharedValue(0);

  useEffect(() => {
    if (reduced || blocked) {
      sheen.value = 0;
      return;
    }
    // A negative value means "not started yet", which keeps the highlight off
    // screen during the two-second hold instead of parked at its start position.
    sheen.value = withDelay(2000, withRepeat(withTiming(1, { duration: 2600 }), -1, false));
  }, [sheen, reduced, blocked]);

  const sheenStyle = useAnimatedStyle(() => ({
    opacity: sheen.value < 0 ? 0 : 1,
    transform: [{ translateX: -40 + sheen.value * 360 }],
  }));

  const isGoogle = tone === 'google';

  return (
    <StreamZPressable
      onPress={onPress}
      disabled={disabled === true || busy}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy, disabled: disabled === true }}
      style={[styles.cta, isGoogle && styles.ctaGoogle, style]}
    >
      {isGoogle ? null : (
        <LinearGradient
          colors={isDone ? (['#1FBF7A', '#0E8F5A'] as const) : ([AUTH.ctaTop, AUTH.ctaBottom] as const)}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      )}
      {!reduced && !blocked && !isGoogle ? (
        <Animated.View pointerEvents="none" style={[styles.ctaSheen, sheenStyle]} />
      ) : null}
      <View style={styles.ctaContent}>
        {icon}
        <StreamZText style={[styles.ctaLabel, isGoogle && styles.ctaLabelGoogle]}>
          {label}
        </StreamZText>
        {trailing}
      </View>
    </StreamZPressable>
  );
};

/** A support link dressed as a chip: hairline ring, accent icon, quiet label. */
export const AuthPillLink = ({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}) => (
  <StreamZPressable onPress={onPress} accessibilityRole="link" style={styles.pill}>
    {icon}
    <StreamZText style={styles.pillLabel}>{label}</StreamZText>
  </StreamZPressable>
);

const KEY_BODY_LENGTH = 20;
const KEY_GROUP = 5;

/**
 * The four group meters under the key field. They read straight off the entered
 * characters, so progress is a fact about the input rather than decoration.
 *
 * A single fill colour, not the mockup's 90° gradient: at 4px tall the two stops
 * are indistinguishable, and animating a gradient's width per keystroke is the
 * more expensive way to draw the same line.
 */
export const SegmentMeters = ({
  entered,
  tone = 'idle',
  reduced = false,
}: {
  entered: number;
  tone?: 'idle' | 'error' | 'done';
  reduced?: boolean;
}) => (
  <View style={styles.meters} accessibilityElementsHidden>
    {Array.from({ length: KEY_BODY_LENGTH / KEY_GROUP }, (_, group) => (
      <Meter
        key={group}
        ratio={Math.min(1, Math.max(0, entered - group * KEY_GROUP) / KEY_GROUP)}
        color={
          tone === 'error' ? AUTH.alert : tone === 'done' ? AUTH.success : MARK_RAMP.bright
        }
        reduced={reduced}
      />
    ))}
  </View>
);

const Meter = ({
  ratio,
  color,
  reduced,
}: {
  ratio: number;
  color: string;
  reduced: boolean;
}) => {
  const value = useSharedValue(reduced ? ratio : 0);
  useEffect(() => {
    value.value = withTiming(ratio, { duration: 350, easing: METER_CURVE });
  }, [ratio, value]);

  // scaleX on a full-width fill, so the animation stays on the UI thread's
  // transform path rather than relaying out a width every frame.
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: value.value }] }));

  return (
    <View style={styles.meterTrack}>
      <Animated.View style={[styles.meterFill, { backgroundColor: color }, style]} />
    </View>
  );
};

/**
 * The success seal: ring and tick each draw once, then the halo pulses twice.
 * Reduced motion shows the finished seal, which states the same fact.
 */
export const SuccessSeal = ({ reduced = false }: { reduced?: boolean }) => {
  // pathLength normalises each stroke to 1, so the dash maths is the same for the
  // 251-unit ring and the 48-unit tick without measuring geometry.
  const ring = useSharedValue(reduced ? 1 : 0);
  const tick = useSharedValue(reduced ? 1 : 0);
  // Negative again: the halo must be absent until its turn in the sequence.
  const halo = useSharedValue(reduced ? 1 : -1);

  useEffect(() => {
    if (reduced) {
      ring.value = 1;
      tick.value = 1;
      halo.value = 1;
      return;
    }
    ring.value = withDelay(
      200,
      withTiming(1, { duration: 700, easing: Easing.bezier(0.4, 0.1, 0.2, 1) }),
    );
    tick.value = withDelay(800, withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) }));
    halo.value = withDelay(
      1000,
      withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) }), 2, false),
    );
  }, [ring, tick, halo, reduced]);

  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: SEAL_RING_LENGTH * (1 - ring.value),
  }));
  const tickProps = useAnimatedProps(() => ({
    strokeDashoffset: SEAL_TICK_LENGTH * (1 - tick.value),
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: halo.value < 0 ? 0 : 0.55 - halo.value * 0.55,
    transform: [{ scale: 0.85 + Math.max(0, halo.value) * 1.05 }],
  }));

  return (
    <View style={styles.seal}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.sealGlow, haloStyle]} />
      <View style={styles.sealWash} />
      <Svg width={112} height={112} accessible={false}>
        <AnimatedCircle
          cx={56}
          cy={56}
          r={40}
          fill="none"
          stroke={AUTH.success}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={SEAL_RING_LENGTH}
          animatedProps={ringProps}
        />
        <AnimatedPath
          d="M40 57 L52 69 L74 45"
          fill="none"
          stroke={AUTH.success}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={SEAL_TICK_LENGTH}
          animatedProps={tickProps}
        />
      </Svg>
    </View>
  );
};

/** Small caps label above a section: 11px, wide tracking, accent-coloured. */
export const AuthKicker = ({ children }: { children: React.ReactNode }) => (
  <StreamZText style={styles.kicker}>{children}</StreamZText>
);

/**
 * The screen's headline in the display face at the auth scale (32px). Takes a text
 * style because the flow centres some of them, and `TextStyle` extends `ViewStyle`.
 */
export const AuthTitle = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}) => (
  <StreamZText style={[styles.title, style]} accessibilityRole="header">
    {children}
  </StreamZText>
);

/** Supporting line under a headline. */
export const AuthLead = ({ children }: { children: React.ReactNode }) => (
  <StreamZText style={styles.lead}>{children}</StreamZText>
);

const styles = StyleSheet.create({
  ink: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: AUTH.ink },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 400 },
  panel: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: AUTH.hairline,
    padding: 20,
  },
  cta: {
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaGoogle: { backgroundColor: '#FFFFFF' },
  ctaLabelGoogle: { color: '#1B1B1F' },
  ctaSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '38%',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  ctaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 12,
  },
  ctaLabel: {
    fontFamily: FONT.sansSemiBold,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  pill: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AUTH.rail,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillLabel: { fontFamily: FONT.sansMedium, fontSize: 13, color: '#E4E4E9' },
  kicker: {
    fontFamily: FONT.sansSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.4,
    color: AUTH.alert,
  },
  title: {
    fontFamily: FONT.displayMedium,
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.8,
    lineHeight: 35,
    color: AUTH.text,
  },
  lead: {
    fontFamily: FONT.sans,
    fontSize: 15,
    lineHeight: 23,
    color: AUTH.muted,
  },
  meters: { flexDirection: 'row', gap: 8, marginTop: 14 },
  meterTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: AUTH.track,
    overflow: 'hidden',
  },
  meterFill: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    transformOrigin: '0% 50%',
  },
  seal: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center' },
  sealWash: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: AUTH.haloGreen,
  },
  sealGlow: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: AUTH.success,
  },
});
