import React, { useEffect } from 'react';
import { Easing } from 'react-native-reanimated';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { HStack } from '@/components/ui/hstack';
import { BRAND_COLOR, MOTION } from '@/src/theme/tokens';

/**
 * The StreamZ loader (PRD §15): three dots breathing in sequence. Deliberately
 * calm — no orbiting, no spinning everything — it reads as "working" without
 * turning every wait into a spectacle.
 */
export const StreamZLoader = ({ size = 8 }: { size?: number }) => {
  const Dot = ({ index }: { index: number }) => {
    const opacity = useSharedValue(0.3);
    useEffect(() => {
      opacity.value = withDelay(
        index * 180,
        withRepeat(
          withTiming(1, { duration: MOTION.base.duration * 3, easing: Easing.inOut(Easing.quad) }),
          -1,
          true,
        ),
      );
    }, [opacity, index]);
    const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
    return (
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: BRAND_COLOR.primary,
            marginHorizontal: 4,
          },
          style,
        ]}
      />
    );
  };

  return (
    <HStack className="items-center justify-center">
      <Dot index={0} />
      <Dot index={1} />
      <Dot index={2} />
    </HStack>
  );
};
