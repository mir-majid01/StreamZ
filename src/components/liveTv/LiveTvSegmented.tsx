import { Box } from '@/components/ui/box';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import { LIVE_TV, RADIUS, SPACE, SURFACE } from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import { LiveTvPressable } from './LiveTvPressable';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Spoken instead of the painted label, for options whose label is a bare word. */
  spoken?: string;
}

interface LiveTvSegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Group name announced before the options ("View", "Channel list"). */
  accessibilityLabel: string;
  /** `tab` when the options switch the whole view, `button` when they filter it. */
  role?: 'tab' | 'button';
  /** Equal-width segments across the row, or content-sized and left-aligned. */
  fill?: boolean;
}

/**
 * The one segmented control the Live TV screen uses for both its nav groups.
 *
 * Geometry comes from `LIVE_TV`, not from a class: the track is 48dp with a 2dp
 * inset, which makes every segment exactly the 44dp touch floor the brief sets —
 * the painted pill and the pressable area are the same box, so there is nothing to
 * fake with padding. Selected fill is the accent at 15%; unselected is bare track.
 * `cardTitle` carries the label in both states so switching an option cannot resize
 * the text it just moved.
 */
export const LiveTvSegmented = <T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  role = 'button',
  fill = true,
}: LiveTvSegmentedProps<T>) => (
  <Box
    className={`flex-row rounded-xl border border-border bg-card ${fill ? '' : 'self-start'}`}
    // A tab group announces itself as one; a filter group stays out of the way and
    // lets each segment be read on its own. A label on a `none` element is ignored,
    // so it is only passed where it will actually be spoken.
    accessibilityRole={role === 'tab' ? 'tablist' : 'none'}
    accessibilityLabel={role === 'tab' ? accessibilityLabel : undefined}
    style={{
      height: LIVE_TV.trackHeight,
      padding: LIVE_TV.trackInset,
      gap: LIVE_TV.trackInset,
      borderRadius: RADIUS.md,
    }}
  >
    {options.map((option) => {
      const selected = option.value === value;
      return (
        <LiveTvPressable
          key={option.value}
          onPress={() => onChange(option.value)}
          role={role}
          selected={selected}
          accessibilityLabel={option.spoken ?? option.label}
          className={`h-full items-center justify-center ${fill ? 'flex-1' : ''} ${
            selected ? 'bg-primary/15' : ''
          }`}
          focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
          pressedStyle={{ backgroundColor: SURFACE.high }}
          style={{
            borderRadius: RADIUS.md - LIVE_TV.trackInset,
            minHeight: LIVE_TV.trackHeight - LIVE_TV.trackInset * 2,
            paddingHorizontal: SPACE.lg,
          }}
        >
          <StreamZText
            variant="cardTitle"
            numberOfLines={1}
            maxFontSizeMultiplier={1.4}
            className={selected ? 'text-foreground' : 'text-muted-foreground'}
          >
            {option.label}
          </StreamZText>
        </LiveTvPressable>
      );
    })}
  </Box>
);
