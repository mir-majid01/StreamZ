import { HStack } from '@/components/ui/hstack';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { StreamZWordmark } from '@/src/components/StreamZWordmark';
import type { ReactNode } from 'react';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
// Display version from `APP_VERSION` in `.env` (via app.config → expoConfig).
import { getAppVersion } from '@/src/utils/appVersion';
import { HEADER, SPACE } from '@/src/theme/tokens';

interface AppHeaderProps {
  /**
   * Trailing action. Sized by the slot, not by the caller's icon: whatever is
   * passed sits inside a `HEADER_ACTION_SIZE` box, so the touch target is a
   * header property rather than a hope.
   */
  right?: ReactNode;
  paddingHorizontal?: number;
  /**
   * 0 → 1 scroll progress driving the sticky-header reveal: 0 while the
   * header still sits over unscrolled content (fully transparent, no
   * backdrop), 1 once the screen has scrolled past its fade distance (solid
   * backdrop + hairline border, the brand lockup settled to its reading size).
   * Omit for a static, always-transparent header (e.g. non-scrolling contexts).
   */
  progress?: SharedValue<number>;
  /**
   * Safe-area top inset (`useSafeAreaInsets().top`), applied as internal
   * padding rather than an external offset so the animated backdrop covers
   * the status bar strip too — otherwise that strip stays transparent while
   * the row below it turns solid, giving a visibly two-toned header.
   */
  topInset?: number;
}

const AnimatedBox = Animated.createAnimatedComponent(Box);

// The header's measurements live in `src/theme/tokens.ts` next to every other
// raw value React Native has to take, so the row can be checked as data rather
// than as pixels (see `__tests__/home-header-layout.test.ts`).
/** Height of the row every header child is centred in. */
export const HEADER_ROW_HEIGHT = HEADER.rowHeight;
/** Trailing-action touch target — the floor is 44dp. */
export const HEADER_ACTION_SIZE = HEADER.actionTarget;
/** Wordmark cap size, unchanged from the previous header. */
export const HEADER_LOGO_SIZE = HEADER.logoSize;
/** Space between the wordmark and the version label. */
export const HEADER_LOCKUP_GAP = HEADER.lockupGap;

// The brand lockup starts slightly larger while it is still floating over the
// hero and settles to its reading size once the header has a solid backdrop. It
// scales from its left edge (`transformOrigin`) so the shrink cannot slide the
// wordmark out from under the row's leading padding — the previous version
// paired the scale with a `translateY` and an animated padding on the label to
// fake the same thing, and they never matched.
const LOGO_SCALE_RANGE: [number, number] = [
  HEADER.logoScaleOverHero,
  HEADER.logoScaleSettled,
];

export const AppHeader = ({
  right,
  paddingHorizontal = SPACE.lg,
  progress,
  topInset = 0,
}: AppHeaderProps) => {
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress?.value ?? 0,
  }));

  const lockupStyle = useAnimatedStyle(() => {
    const p = progress?.value ?? 0;
    return {
      transform: [
        {
          scale: interpolate(p, [0, 1], LOGO_SCALE_RANGE, Extrapolation.CLAMP),
        },
      ],
    };
  });

  return (
    <Box className="relative" style={{ paddingTop: topInset }}>
      {/* Backdrop: only the hero strip is unbacked, and the scrim the hero
          paints starts at `transparent` at its top edge, so the header has to
          earn its own contrast. It does — the lockup is brand-red/white text,
          and the action carries its own surface (see HomeScreen) — and this
          layer turns the strip solid once content has scrolled under it. */}
      <AnimatedBox
        className="absolute inset-0 border-b border-border bg-background"
        style={backdropStyle}
        pointerEvents="none"
      />
      <Box
        className="flex-row items-center justify-between"
        style={{ height: HEADER_ROW_HEIGHT, paddingHorizontal }}
      >
        <Animated.View
          style={[lockupStyle, { transformOrigin: 'left center' }]}
        >
          {/* The wordmark sizes itself. It used to be pinned inside a fixed
              88px box, and "StreamZ" at 19px with the brand's wide tracking is
              wider than that — which is why the logo read as cut off. */}
          <HStack className="items-center">
            <StreamZWordmark size={HEADER_LOGO_SIZE} />
            <Text
              size="xs"
              className="text-muted-foreground"
              style={{ marginLeft: HEADER_LOCKUP_GAP }}
            >
              v{getAppVersion()}
            </Text>
          </HStack>
        </Animated.View>
        <Box
          className="items-center justify-center"
          style={{ minWidth: HEADER_ACTION_SIZE, minHeight: HEADER_ACTION_SIZE }}
          pointerEvents="box-none"
        >
          {right}
        </Box>
      </Box>
    </Box>
  );
};
