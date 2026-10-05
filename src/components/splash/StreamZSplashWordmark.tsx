import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Box } from '@/components/ui/box';
import { BRAND } from '@/src/config/brand';

/**
 * The StreamZ splash ident: the wordmark set in the brand accent, revealed letter by letter
 * over a rule that draws itself underneath. It replaces upstream Flick's hand-drawn SVG
 * wordmark — the paths in `FlickSwoopLogo` literally spell FLICK, so they cannot be re-skinned.
 */
const LETTER_STAGGER_MS = 90;
const LETTER_MS = 260;
const RULE_MS = 320;

const WORD = BRAND.name;

/** When the loading copy may fade in: after the last letter has landed. */
export const WORD_REVEAL_MS = (WORD.length - 1) * LETTER_STAGGER_MS + LETTER_MS;
/** When the whole ident is finished, used by the splash as a fallback exit timer. */
export const TOTAL_MS = WORD_REVEAL_MS + RULE_MS;

const LOGO_WIDTH_RATIO = 0.72;
const LOGO_MAX_WIDTH = 340;

export const splashLogoSize = (windowWidth: number) => {
  const width = Math.min(windowWidth * LOGO_WIDTH_RATIO, LOGO_MAX_WIDTH);
  // One line of the wordmark plus the rule and its gap.
  return { width, height: width * 0.22 };
};

const Letter = ({ character, index, fontSize }: { character: string; index: number; fontSize: number }) => {
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(
      index * LETTER_STAGGER_MS,
      withTiming(1, { duration: LETTER_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [enter, index]);

  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * fontSize * 0.25 }],
  }));

  return (
    <Animated.Text
      accessible={false}
      style={[styles.letter, { fontSize, lineHeight: fontSize * 1.25 }, style]}
    >
      {character}
    </Animated.Text>
  );
};

export const StreamZSplashWordmark = ({ onDrawEnd }: { onDrawEnd?: () => void }) => {
  const { width: windowWidth } = useWindowDimensions();
  const { width, height } = splashLogoSize(windowWidth);
  const fontSize = height * 0.62;
  const rule = useSharedValue(0);

  useEffect(() => {
    rule.value = withDelay(
      WORD_REVEAL_MS,
      withTiming(1, { duration: RULE_MS, easing: Easing.out(Easing.quad) }),
    );
    // The parent keeps its own fallback timer; this callback just lets it exit early when
    // the ident finished as scheduled.
    const done = setTimeout(() => onDrawEnd?.(), TOTAL_MS);
    return () => clearTimeout(done);
  }, [rule, onDrawEnd]);

  const ruleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: rule.value }],
    opacity: 0.35 + rule.value * 0.65,
  }));

  const letters = useMemo(() => Array.from(WORD), []);

  return (
    <Box
      style={{ width, height }}
      className="justify-center"
      accessible
      accessibilityLabel={BRAND.name}
    >
      <Box className="flex-row items-end justify-center">
        {letters.map((character, index) => (
          <Letter key={`${character}-${index}`} character={character} index={index} fontSize={fontSize} />
        ))}
      </Box>
      <Animated.View
        style={[styles.rule, { width, transform: [{ translateX: 0 }] }, ruleStyle]}
        pointerEvents="none"
      />
    </Box>
  );
};

const styles = StyleSheet.create({
  letter: {
    color: BRAND.accentHex,
    fontWeight: '800',
    letterSpacing: 2,
  },
  rule: {
    height: 2,
    borderRadius: 2,
    marginTop: 6,
    alignSelf: 'center',
    backgroundColor: BRAND.accentHex,
  },
});
