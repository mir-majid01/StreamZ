import React from 'react';
import { Pressable, type PressableProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MOTION } from '@/src/theme/tokens';

/**
 * Base tactile primitive (PRD §29): every interactive surface presses to
 * `pressScale` and springs back on release. Reduces-motion respect comes free
 * from the OS to reanimated bridge; the scale is deliberately small so the
 * feedback reads as weight, not bounce.
 */
export type StreamZPressableProps = PressableProps & {
  /** Disable the scale feedback (e.g. full-bleed rows where it looks like lag). */
  noScale?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const StreamZPressable = ({ noScale, onPressIn, onPressOut, style, ...props }: StreamZPressableProps) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPressIn={(e) => {
        if (!noScale) scale.value = withTiming(MOTION.pressScale, { duration: MOTION.fast.duration });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!noScale) scale.value = withSpring(1, MOTION.spring);
        onPressOut?.(e);
      }}
      style={[animatedStyle, style]}
      {...props}
    />
  );
};
