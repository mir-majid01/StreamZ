import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Box } from '@/components/ui/box';
import { StreamZLogo } from '@/src/components/streamz';
import { identTimeline } from '@/src/utils/startupSequence';

/**
 * The StreamZ splash ident (PRD §14): after a beat of black and ambient glow,
 * the full logo fades and scales into position and settles. One lockup, one
 * motion — the letter-by-letter reveal it replaces fought the new identity
 * instead of presenting it.
 *
 * The schedule is decided in `startupSequence.ts` and only consumed here, because the screen
 * has to be able to hold the app open for exactly as long as this component says it will take,
 * and two copies of a timeline are how a handoff ends up racing the animation it is waiting on.
 *
 * Completion is reported from the animation's own finish callback, not from a timer aimed at
 * it. The screen still keeps a bounded watchdog in case a callback is lost, but that bound is
 * this same number, so the artwork can never be the reason the app was late.
 */

const LOGO_WIDTH_RATIO = 0.66;
const LOGO_MAX_WIDTH = 320;

export const splashLogoSize = (windowWidth: number) => {
  const width = Math.min(windowWidth * LOGO_WIDTH_RATIO, LOGO_MAX_WIDTH);
  return { width, height: width * 0.3 };
};

export const StreamZSplashWordmark = ({
  reduced = false,
  onSettled,
  onDrawEnd,
}: {
  reduced?: boolean;
  /** The lockup is in place; status copy may appear from here on. */
  onSettled?: () => void;
  /** The ident has fully drawn. The screen's own readiness signal. */
  onDrawEnd?: () => void;
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const { width, height } = splashLogoSize(windowWidth);
  const logoSize = height * 0.42;
  const timeline = useMemo(() => identTimeline(reduced), [reduced]);

  const enter = useSharedValue(reduced ? 1 : 0);
  const rule = useSharedValue(reduced ? 1 : 0);

  // Kept in refs so a parent re-render cannot restart the ident halfway through, which would
  // re-run the animation from zero and push the handoff back by a whole timeline. The two
  // stable callbacks below are what the worklets hand to `runOnJS`: a worklet may capture a
  // function, but reading a ref's `.current` from the UI thread is not a thing it can do, so
  // the ref is only ever touched back on the JS thread.
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const drawEndRef = useRef(onDrawEnd);
  drawEndRef.current = onDrawEnd;
  const reportSettled = useCallback(() => settledRef.current?.(), []);
  const reportDrawEnd = useCallback(() => drawEndRef.current?.(), []);

  useEffect(() => {
    if (!timeline.animated) {
      // Nothing to draw out: place the ident at its finished state and report both signals
      // now, so the handoff waits on the gate alone.
      enter.value = 1;
      rule.value = 1;
      reportSettled();
      reportDrawEnd();
      return;
    }

    enter.value = withDelay(
      timeline.logoDelayMs,
      withTiming(
        1,
        { duration: timeline.logoDurationMs, easing: Easing.out(Easing.cubic) },
        (finished) => {
          'worklet';
          // `finished` is false when the animation was superseded rather than completed; the
          // screen's watchdog owns that case, and reporting a draw that did not happen would
          // be worse than being late for one.
          if (finished) runOnJS(reportSettled)();
        },
      ),
    );
    rule.value = withDelay(
      timeline.settleMs,
      withTiming(
        1,
        { duration: timeline.ruleDurationMs, easing: Easing.out(Easing.quad) },
        (finished) => {
          'worklet';
          if (finished) runOnJS(reportDrawEnd)();
        },
      ),
    );
  }, [
    enter,
    rule,
    reportDrawEnd,
    reportSettled,
    timeline.animated,
    timeline.logoDelayMs,
    timeline.logoDurationMs,
    timeline.ruleDurationMs,
    timeline.settleMs,
  ]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.94 + enter.value * 0.06 }],
  }));

  const ruleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: rule.value }],
    opacity: 0.25 + rule.value * 0.5,
  }));

  return (
    <Box style={{ width, height }} className="justify-center" accessible accessibilityLabel="StreamZ">
      <Animated.View style={logoStyle}>
        <Box className="w-full items-center">
          <StreamZLogo size={logoSize} />
        </Box>
      </Animated.View>
      <Animated.View style={[styles.rule, { width: width * 0.6 }, ruleStyle]} pointerEvents="none" />
    </Box>
  );
};

const styles = StyleSheet.create({
  rule: {
    height: 2,
    borderRadius: 2,
    marginTop: 14,
    alignSelf: 'center',
    backgroundColor: '#E50914',
  },
});
