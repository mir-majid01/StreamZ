import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Box } from '@/components/ui/box';
import { StreamZLogo } from '@/src/components/streamz';

/**
 * The StreamZ splash ident (PRD §14): after a beat of black and ambient glow,
 * the full logo fades and scales into position and settles. One lockup, one
 * motion — the letter-by-letter reveal it replaces fought the new identity
 * instead of presenting it.
 */
export const GLOW_MS = 240;
export const LOGO_IN_MS = 380;
export const LOGO_MS = 620;
/** When the logo has settled — the splash may show status copy from here on. */
export const LOGO_SETTLE_MS = LOGO_IN_MS + LOGO_MS;
/** Fallback upper bound for the ident, after which the splash exits regardless. */
export const TOTAL_MS = LOGO_SETTLE_MS + 240;

const LOGO_WIDTH_RATIO = 0.66;
const LOGO_MAX_WIDTH = 320;

export const splashLogoSize = (windowWidth: number) => {
  const width = Math.min(windowWidth * LOGO_WIDTH_RATIO, LOGO_MAX_WIDTH);
  return { width, height: width * 0.3 };
};

export const StreamZSplashWordmark = ({ onDrawEnd }: { onDrawEnd?: () => void }) => {
  const { width: windowWidth } = useWindowDimensions();
  const { width, height } = splashLogoSize(windowWidth);
  const logoSize = height * 0.42;

  const enter = useSharedValue(0);
  const rule = useSharedValue(0);

  useEffect(() => {
    enter.value = withDelay(
      LOGO_IN_MS,
      withTiming(1, { duration: LOGO_MS, easing: Easing.out(Easing.cubic) }),
    );
    rule.value = withDelay(
      LOGO_SETTLE_MS,
      // Ends exactly at TOTAL_MS so onDrawEnd coincides with the ident
      // finishing — the splash handoff must not cut it short.
      withTiming(1, { duration: TOTAL_MS - LOGO_SETTLE_MS, easing: Easing.out(Easing.quad) }),
    );
    const done = setTimeout(() => onDrawEnd?.(), TOTAL_MS);
    return () => clearTimeout(done);
  }, [enter, rule, onDrawEnd]);

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
