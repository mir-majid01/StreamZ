import { memo, useCallback, useMemo } from 'react';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Star } from 'lucide-react-native';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import type { LiveChannel } from '@/src/services/DaddyLiveService';
import {
  BRAND_COLOR,
  LIVE_TV,
  RADIUS,
  SPACE,
  SURFACE,
} from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import { ChannelLogo } from './ChannelLogo';
import { LiveTvPressable } from './LiveTvPressable';
import {
  favoriteControlLabel,
  getRowSecondary,
  playControlLabel,
} from './liveTvLayout';

interface LiveChannelRowProps {
  channel: LiveChannel;
  starred: boolean;
  resolving: boolean;
  onOpen: (channel: LiveChannel) => void;
  onToggleFavorite: (channelId: string) => void;
}

/**
 * One channel. Memoised, and it only ever receives primitives plus a catalogue
 * object whose identity the service keeps stable — so scrolling 12,500 of these
 * re-renders the handful that enter the window and nothing else. That matters
 * beyond smoothness: on this architecture every newly-realized sibling asks the
 * blend-mode helper to re-tag its container, which is the O(N²) cost that produced
 * the ANR this branch just fixed.
 *
 * The text block is `flex-1`, so a 72-character name ellipsizes on one line instead
 * of pushing the star off-screen or reflowing the row; the star sits in the row's
 * own centred axis, so it is vertically aligned to the two-line block rather than
 * optically guessed at.
 */
export const LiveChannelRow = memo(function LiveChannelRow({
  channel,
  starred,
  resolving,
  onOpen,
  onToggleFavorite,
}: LiveChannelRowProps) {
  const secondary = useMemo(() => getRowSecondary(channel), [channel]);
  const press = useCallback(() => onOpen(channel), [channel, onOpen]);
  const toggle = useCallback(
    () => onToggleFavorite(channel.id),
    [channel.id, onToggleFavorite],
  );

  return (
    <LiveTvPressable
      onPress={press}
      accessibilityLabel={playControlLabel(channel.name)}
      className="flex-row items-center rounded-xl border border-border bg-card"
      focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
      pressedStyle={{ backgroundColor: SURFACE.mid }}
      style={{
        minHeight: LIVE_TV.rowMinHeight,
        borderRadius: RADIUS.md,
        paddingLeft: SPACE.md,
        paddingRight: SPACE.xs,
      }}
    >
      <ChannelLogo name={channel.name} logoUrl={channel.logoUrl} />

      <VStack className="ml-3 flex-1 justify-center">
        <StreamZText
          variant="cardTitle"
          numberOfLines={1}
          maxFontSizeMultiplier={LIVE_TV.rowMaxFontScale}
          className="text-foreground"
        >
          {channel.name}
        </StreamZText>
        {secondary ? (
          <HStack className="mt-1 items-center">
            {/* Always painted, even when there is nothing to say with colour: the dot
                is 6dp wide and the line after it is inset by 8, so every secondary
                line — now, next, or category — starts on the same x. */}
            <Box
              className={`h-1.5 w-1.5 rounded-full ${
                secondary.tone === 'now'
                  ? 'bg-primary'
                  : secondary.tone === 'next'
                    ? 'bg-muted-foreground'
                    : 'bg-transparent'
              }`}
            />
            <StreamZText
              variant="secondary"
              numberOfLines={1}
              maxFontSizeMultiplier={LIVE_TV.rowMaxFontScale}
              className="ml-2 flex-1"
            >
              {secondary.line}
            </StreamZText>
          </HStack>
        ) : null}
      </VStack>

      {/* Resolving paints over the star rather than beside it: one trailing column,
          so starting a stream cannot shift anything in the row. */}
      <LiveTvPressable
        onPress={toggle}
        selected={starred}
        accessibilityLabel={favoriteControlLabel(channel.name, starred)}
        className={`items-center justify-center rounded-full ${starred ? 'bg-primary/10' : ''}`}
        focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
        pressedStyle={{ backgroundColor: SURFACE.high }}
        style={{
          width: LIVE_TV.rowActionTarget,
          height: LIVE_TV.rowActionTarget,
          borderRadius: RADIUS.pill,
        }}
      >
        {/* The icon step is the gluestack scale: "lg" is 20dp, which is `ICON_SIZE.row`. */}
        {resolving ? (
          <Spinner size="small" color={BRAND_COLOR.primary} />
        ) : (
          <Icon
            as={Star}
            size="lg"
            className={starred ? 'text-primary' : 'text-muted-foreground'}
          />
        )}
      </LiveTvPressable>
    </LiveTvPressable>
  );
});
