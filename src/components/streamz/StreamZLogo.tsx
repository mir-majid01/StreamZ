import React, { useEffect } from 'react';
import { Text, type TextStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { HStack } from '@/components/ui/hstack';
import { StreamZText } from './StreamZText';
import { FONT, MARK_RAMP } from '@/src/theme/tokens';

/**
 * The logo system: a Z built from two rails and one red cut, where the top rail
 * ends in a play head so the letter reads as forward motion.
 *
 * The geometry lives in `src/brand/zMarkGeometry.ts` — this file draws it, and
 * `scripts/generate-brand-assets.mjs` rasterises the same numbers for the Android
 * launcher icon. That is what keeps the splash logo and the app icon one mark
 * instead of two copies that drift; see the regression test
 * `__tests__/brand-launcher-assets.test.ts`.
 */
import {
  BOTTOM_END,
  BOTTOM_Y,
  DIAGONAL_D as DIAGONAL,
  DIAGONAL_LENGTH,
  MARK_VIEW_BOX,
  PLAY_HEAD_D as PLAY_HEAD,
  RAIL,
  RAIL_RADIUS,
  SPINE_X,
  TOP_END,
  TOP_Y,
} from '@/src/brand/zMarkGeometry';

const GRADIENT_ID = 'streamzZ';

const Ramp = () => (
  <Defs>
    <LinearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
      <Stop offset="0" stopColor={MARK_RAMP.bright} />
      <Stop offset="1" stopColor={MARK_RAMP.deep} />
    </LinearGradient>
  </Defs>
);

export const StreamZZMark = ({
  size = 28,
  mono = false,
  color = '#FFFFFF',
  accent = true,
}: {
  size?: number;
  mono?: boolean;
  color?: string;
  accent?: boolean;
}) => {
  const diagonal = mono || !accent ? color : `url(#${GRADIENT_ID})`;
  return (
    <Svg width={size} height={size} viewBox={MARK_VIEW_BOX} fill="none" accessible={false}>
      {!mono && accent && <Ramp />}
      <Rect x={SPINE_X} y={TOP_Y - RAIL / 2} width={TOP_END - SPINE_X} height={RAIL} rx={RAIL_RADIUS} fill={color} />
      <Path d={PLAY_HEAD} fill={color} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d={DIAGONAL} stroke={diagonal} strokeWidth={RAIL} strokeLinecap="round" fill="none" />
      <Rect x={SPINE_X} y={BOTTOM_Y - RAIL / 2} width={BOTTOM_END - SPINE_X} height={RAIL} rx={RAIL_RADIUS} fill={color} />
    </Svg>
  );
};

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const ease = Easing.out(Easing.cubic);

/**
 * The mark drawing itself in, for the first screen only: both rails extend from
 * the spine, the cut sweeps down, and the play head arrives last. Each part gets
 * its own shared value so the motion spec's per-stage durations and easings hold
 * exactly; `delay` staggers the whole sequence against a screen's own entrance.
 */
export const AnimatedStreamZZMark = ({
  size = 28,
  delay = 0,
  reduced = false,
  color = '#FFFFFF',
}: {
  size?: number;
  /** Stagger in ms; the splash sequence chains several marks. */
  delay?: number;
  /** Skip the choreography and paint the finished mark. */
  reduced?: boolean;
  color?: string;
}) => {
  const topRail = useSharedValue(reduced ? 1 : 0);
  const baseRail = useSharedValue(reduced ? 1 : 0);
  const cut = useSharedValue(reduced ? 1 : 0);
  const head = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      topRail.value = 1;
      baseRail.value = 1;
      cut.value = 1;
      head.value = 1;
      return;
    }
    topRail.value = withDelay(delay, withTiming(1, { duration: 550, easing: ease }));
    head.value = withDelay(delay + 750, withTiming(1, { duration: 450, easing: ease }));
    cut.value = withDelay(delay + 850, withTiming(1, { duration: 500, easing: ease }));
    baseRail.value = withDelay(delay + 1200, withTiming(1, { duration: 600, easing: ease }));
  }, [delay, reduced, topRail, baseRail, cut, head]);

  const topRailProps = useAnimatedProps(() => ({ width: (TOP_END - SPINE_X) * topRail.value }));
  const baseRailProps = useAnimatedProps(() => ({ width: (BOTTOM_END - SPINE_X) * baseRail.value }));
  const cutProps = useAnimatedProps(() => ({ strokeDashoffset: DIAGONAL_LENGTH * (1 - cut.value) }));
  const headProps = useAnimatedProps(() => ({ opacity: head.value }));

  return (
    <Svg width={size} height={size} viewBox={MARK_VIEW_BOX} fill="none" accessible={false}>
      <Ramp />
      <AnimatedRect
        x={SPINE_X}
        y={TOP_Y - RAIL / 2}
        height={RAIL}
        rx={RAIL_RADIUS}
        fill={color}
        animatedProps={topRailProps}
      />
      <AnimatedPath
        d={PLAY_HEAD}
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        animatedProps={headProps}
      />
      <AnimatedPath
        d={DIAGONAL}
        stroke={`url(#${GRADIENT_ID})`}
        strokeWidth={RAIL}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${DIAGONAL_LENGTH} ${DIAGONAL_LENGTH}`}
        animatedProps={cutProps}
      />
      <AnimatedRect
        x={SPINE_X}
        y={BOTTOM_Y - RAIL / 2}
        height={RAIL}
        rx={RAIL_RADIUS}
        fill={color}
        animatedProps={baseRailProps}
      />
    </Svg>
  );
};

export const StreamZLogo = ({
  size = 28,
  mono = false,
  color = '#FFFFFF',
}: {
  /** Cap height of the wordmark text; the Z scales to match. */
  size?: number;
  mono?: boolean;
  color?: string;
}) => (
  <HStack className="items-center" space="xs">
    <StreamZText
      style={{
        fontFamily: FONT.display,
        fontSize: size,
        lineHeight: size * 1.1,
        color,
        letterSpacing: -0.5,
      }}
    >
      Stream
    </StreamZText>
    <StreamZZMark size={size * 1.02} color={color} accent={!mono} />
  </HStack>
);

/**
 * The horizontal lockup: mark beside the wordmark, with only the Z carrying the
 * accent. This is the form the auth screens lead with, where the mark alone is
 * too quiet to establish the brand.
 *
 * The Z is a nested Text carrying the same metrics as its parent rather than a
 * sibling, because two siblings always take the stack's gap — and "Stream Z" is
 * not the wordmark. Repeating the font on the child keeps Android from falling
 * back to the system face on nested text.
 */
export const StreamZWordmark = ({
  size = 20,
  mark = true,
  color = '#FFFFFF',
}: {
  size?: number;
  /** Pass false where the mark already appears elsewhere on the screen. */
  mark?: boolean;
  color?: string;
}) => {
  const word: TextStyle = {
    fontFamily: FONT.display,
    fontSize: size,
    lineHeight: size * 1.15,
    color,
    letterSpacing: -size * 0.02,
  };
  return (
    <HStack className="items-center" space="sm">
      {mark ? <StreamZZMark size={size * 1.5} color={color} /> : null}
      <StreamZText style={word}>
        Stream
        <Text style={{ ...word, color: MARK_RAMP.bright }}>Z</Text>
      </StreamZText>
    </HStack>
  );
};
