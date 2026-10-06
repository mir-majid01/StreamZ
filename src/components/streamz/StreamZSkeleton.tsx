import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Box } from '@/components/ui/box';
import { MOTION } from '@/src/theme/tokens';

/**
 * Shimmer skeleton (PRD §15, §32): the loading state that replaces bare
 * spinners in content surfaces. The shimmer is a slow opacity breath — no
 * translation, no layout cost — and stops as soon as it unmounts.
 */
export const StreamZSkeleton = ({
  width,
  height,
  radius = 12,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) => {
  const shimmer = useSharedValue(0.45);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(0.85, { duration: MOTION.cinematic.duration, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Box
      className="bg-muted"
      style={[{ width, height, borderRadius: radius }, style]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#2A2A31', borderRadius: radius }, animatedStyle]} />
    </Box>
  );
};

/** Vertical stack of skeleton rows sized like a poster card column. */
export const StreamZSkeletonRow = ({ cardWidth }: { cardWidth: number }) => (
  <>
    {[0, 1, 2, 3].map((i) => (
      <Box key={i} className="mr-3">
        <StreamZSkeleton width={cardWidth} height={cardWidth * 1.5} radius={12} />
        <StreamZSkeleton width={cardWidth * 0.8} height={12} radius={6} style={{ marginTop: 8 }} />
      </Box>
    ))}
  </>
);
