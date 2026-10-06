import React, { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { BRAND_COLOR, MOTION } from '@/src/theme/tokens';

/**
 * The ambient background (PRD §17, §30): black base under one large, very
 * quiet red bloom that drifts almost imperceptibly. The user should feel the
 * motion rather than watch it; reanimated's default reduce-motion handling
 * freezes the drift for users who opt out of animation.
 */
const Glow = ({
  size,
  opacity,
  duration,
  from,
  to,
}: {
  size: number;
  opacity: number;
  duration: number;
  from: { top: number; left: number };
  to: { x: number; y: number };
}) => {
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [drift, duration]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value * to.x }, { translateY: drift.value * to.y }],
  }));

  return (
    <Animated.View style={[{ position: 'absolute', top: from.top, left: from.left }, style]}>
      <Svg width={size} height={size} accessible={false}>
        <Defs>
          <RadialGradient id="streamzAmbient" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={BRAND_COLOR.primary} stopOpacity={opacity} />
            <Stop offset="0.55" stopColor={BRAND_COLOR.primary} stopOpacity={opacity * 0.3} />
            <Stop offset="1" stopColor={BRAND_COLOR.primary} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#streamzAmbient)" />
      </Svg>
    </Animated.View>
  );
};

export const StreamZAmbient = ({ intensity = 1 }: { intensity?: number }) => {
  const { width, height } = useWindowDimensions();
  const large = Math.max(width, height) * 1.15;
  const small = Math.min(width, height) * 0.9;

  return (
    <React.Fragment>
      <Glow
        size={large}
        opacity={0.14 * intensity}
        duration={MOTION.ambient.duration}
        from={{ top: -large * 0.32, left: -large * 0.18 }}
        to={{ x: 16, y: -10 }}
      />
      <Glow
        size={small}
        opacity={0.07 * intensity}
        duration={MOTION.ambient.duration * 1.4}
        from={{ top: height - small * 0.55, left: -small * 0.35 }}
        to={{ x: -12, y: 10 }}
      />
    </React.Fragment>
  );
};
