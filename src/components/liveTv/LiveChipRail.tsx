import { Box } from '@/components/ui/box';
import { ScrollView } from '@/components/ui/scroll-view';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import { LIVE_TV, RADIUS, SPACE, SURFACE } from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import { LiveTvPressable } from './LiveTvPressable';
import { getChipMaxWidth } from './liveTvLayout';

export interface RailItem {
  key: string;
  label: string;
}

interface LiveChipRailProps {
  items: readonly RailItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  accessibilityLabel: string;
  /** The screen's own horizontal inset, applied as real padding inside the rail. */
  horizontalPadding: number;
  screenWidth: number;
}

/**
 * The horizontal chip rail — categories in both modes, EPG days in schedule mode.
 *
 * Two things it exists to get right. The rail's inset is the screen's real padding on the scroll
 * content, so the last chip stops at the content edge instead of running under it (a negative
 * margin would only move the clip somewhere else). And the height is fixed from `LIVE_TV`, so
 * switching mode cannot shift the list under it. A chip paints at 36dp and carries
 * `chipHitSlop` above and below, which is the 44dp target without the pill growing.
 *
 * An unselected chip is a raised tile with its own hairline edge. It used to be `bg-card` on a
 * card-coloured page, which painted nothing: three separate controls read as one run-on phrase,
 * and only the selected one looked pressable. The active chip still takes the accent as a border
 * plus a tint; the segmented control takes it as a fill. Same colour, two families, one system.
 */
export const LiveChipRail = ({
  items,
  activeKey,
  onSelect,
  accessibilityLabel,
  horizontalPadding,
  screenWidth,
}: LiveChipRailProps) => {
  const chipMaxWidth = getChipMaxWidth(screenWidth);

  return (
    <Box>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityLabel={accessibilityLabel}
        style={{ height: LIVE_TV.chipRailHeight }}
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          gap: LIVE_TV.chipGap,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {items.map((item) => {
          const selected = item.key === activeKey;
          return (
            <LiveTvPressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              selected={selected}
              accessibilityLabel={item.label}
              hitSlop={{ top: LIVE_TV.chipHitSlop, bottom: LIVE_TV.chipHitSlop, left: 2, right: 2 }}
              className={`flex-row items-center justify-center rounded-full border ${
                selected ? 'border-primary/40 bg-primary/10' : 'border-transparent'
              }`}
              focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
              pressedStyle={{ backgroundColor: SURFACE.high }}
              style={{
                height: LIVE_TV.chipHeight,
                maxWidth: chipMaxWidth,
                borderRadius: RADIUS.pill,
                paddingHorizontal: SPACE.md,
                // Pressing has to stay visible, so the resting tile sits a step below
                // `SURFACE.high` rather than on it.
                backgroundColor: selected ? undefined : SURFACE.mid,
                borderColor: selected ? undefined : 'rgba(255,255,255,0.08)',
              }}
            >
              {/* `body` (Inter 400) rather than `cardTitle`: the weight is what tells a
                  chip apart from a segment, since both sit on the accent. */}
              <StreamZText
                variant="body"
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                className={selected ? 'text-foreground' : 'text-muted-foreground'}
              >
                {item.label}
              </StreamZText>
            </LiveTvPressable>
          );
        })}
      </ScrollView>
    </Box>
  );
};
