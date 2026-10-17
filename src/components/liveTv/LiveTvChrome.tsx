import type { ReactNode } from 'react';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Box } from '@/components/ui/box';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Radio, RefreshCw } from 'lucide-react-native';
import { StreamZSkeleton } from '@/src/components/streamz/StreamZSkeleton';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import {
  BRAND_COLOR,
  HEADER,
  LIVE_TV,
  RADIUS,
  SPACE,
  SURFACE,
  TYPE_SIZE,
} from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import { LiveTvPressable } from './LiveTvPressable';

/**
 * The identity band. The broadcast mark leads, the title and the catalogue's own
 * numbers sit on one centred line, and the trailing action is the header's 44dp
 * circular control — the same slot Home gives its search action, so the top of a
 * StreamZ screen reads the same whatever it is.
 */
export const LiveTvIdentityBar = ({
  title,
  summary,
  right,
}: {
  title: string;
  summary?: string;
  right?: ReactNode;
}) => (
  <HStack className="items-center justify-between" style={{ minHeight: HEADER.rowHeight }}>
    <HStack className="items-center">
      <Icon as={Radio} size="xl" className="text-primary" />
      <VStack className="ml-3">
        <StreamZText
          variant="screenTitle"
          numberOfLines={1}
          maxFontSizeMultiplier={1.2}
          className="text-foreground"
        >
          {title}
        </StreamZText>
        {summary ? (
          <StreamZText variant="metadata" numberOfLines={1} style={{ marginTop: 2 }}>
            {summary}
          </StreamZText>
        ) : null}
      </VStack>
    </HStack>
    {right ? <Box className="items-center justify-center">{right}</Box> : null}
  </HStack>
);

/** Real action, real state: it re-reads the catalogue, and says so while it does. */
export const LiveTvRefreshAction = ({
  refreshing,
  onPress,
}: {
  refreshing: boolean;
  onPress: () => void;
}) => (
  <LiveTvPressable
    onPress={onPress}
    disabled={refreshing}
    accessibilityLabel={refreshing ? 'Refreshing Live TV' : 'Refresh Live TV'}
    className="items-center justify-center rounded-full border border-border bg-card"
    focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
    pressedStyle={{ backgroundColor: SURFACE.high }}
    style={{
      width: HEADER.actionTarget,
      height: HEADER.actionTarget,
      borderRadius: RADIUS.pill,
    }}
  >
    {refreshing ? (
      <Spinner size="small" color={BRAND_COLOR.primary} />
    ) : (
      <Icon as={RefreshCw} size="lg" className="text-foreground" />
    )}
  </LiveTvPressable>
);

/**
 * The first paint is the chrome at full size with its content breathing, not a
 * spinner over an empty screen: the screen reads as Live TV from the first frame,
 * and nothing moves when the catalogue lands. Fixed at five rows, so the wait costs
 * five nodes rather than a list.
 */
export const LiveTvSkeleton = ({
  horizontalPadding,
  rows = 5,
}: {
  horizontalPadding: number;
  rows?: number;
}) => (
  <VStack
    style={{
      gap: LIVE_TV.bandGap,
      paddingLeft: horizontalPadding,
      paddingRight: horizontalPadding,
      paddingTop: SPACE.sm,
    }}
  >
    <StreamZSkeleton width="100%" height={LIVE_TV.trackHeight} radius={RADIUS.md} />
    <StreamZSkeleton width="100%" height={LIVE_TV.searchFieldHeight} radius={RADIUS.pill} />
    <StreamZSkeleton width={232} height={LIVE_TV.trackHeight} radius={RADIUS.md} />
    <HStack style={{ gap: LIVE_TV.chipGap }}>
      {[96, 128, 84, 112, 72].map((width) => (
        <StreamZSkeleton
          key={width}
          width={width}
          height={LIVE_TV.chipHeight}
          radius={RADIUS.pill}
        />
      ))}
    </HStack>
    <VStack style={{ gap: LIVE_TV.rowGap, marginTop: SPACE.sm }}>
      {Array.from({ length: rows }, (_, index) => (
        <Box
          key={index}
          className="flex-row items-center rounded-xl border border-border bg-card"
          style={{ minHeight: LIVE_TV.rowMinHeight, borderRadius: RADIUS.md, paddingHorizontal: SPACE.md }}
        >
          <StreamZSkeleton width={LIVE_TV.logoTile} height={LIVE_TV.logoTile} radius={RADIUS.sm} />
          <VStack className="ml-3 flex-1" style={{ gap: SPACE.xs }}>
            <StreamZSkeleton width="72%" height={TYPE_SIZE.cardTitle} radius={6} />
            <StreamZSkeleton width="46%" height={TYPE_SIZE.secondary} radius={6} />
          </VStack>
          <StreamZSkeleton width={LIVE_TV.rowActionTarget} height={LIVE_TV.rowActionTarget} radius={RADIUS.pill} />
        </Box>
      ))}
    </VStack>
  </VStack>
);
