import { memo, useCallback, useMemo, useState } from 'react';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import type { LiveChannel } from '@/src/services/DaddyLiveService';
import { BRAND_COLOR, LIVE_TV, RADIUS, SPACE, SURFACE } from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import { ChannelLogo } from './ChannelLogo';
import { LiveTvPressable } from './LiveTvPressable';
import { formatCount, playControlLabel, getEventChannelPreview, hasHiddenEventChannels } from './liveTvLayout';
import type { ScheduleRow } from './liveTvLayout';

type EventRow = Extract<ScheduleRow, { kind: 'event' }>;

interface LiveScheduleEventRowProps {
  row: EventRow;
  /** The channel behind each listing entry, resolved by id in the screen. */
  resolveChannel: (reference: { id: string; name: string }) => LiveChannel;
  resolvingId: string | null;
  onOpen: (channel: LiveChannel) => void;
}

/**
 * A listing, built to be read next to a channel row rather than as a different
 * product: same card surface, same radius, same 15px title, and the same trailing
 * spinner column. The time sits in a fixed, right-aligned 64dp rule — column
 * alignment is what makes a schedule scannable, and it is the one thing a
 * variable-width time label cannot give you.
 */
export const LiveScheduleEventRow = memo(function LiveScheduleEventRow({
  row,
  resolveChannel,
  resolvingId,
  onOpen,
}: LiveScheduleEventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { event, timeLabel } = row;
  const channels = event.channels;
  // Resolved once per row, not once per render of a sub-row: the schedule reads a
  // 12,500-entry catalogue by id, and an event can name a channel the current
  // catalogue no longer carries.
  const listings = useMemo(
    () =>
      getEventChannelPreview(channels, expanded).map((reference) => ({
        reference,
        channel: resolveChannel(reference),
      })),
    [channels, expanded, resolveChannel],
  );
  const toggleAll = useCallback(() => setExpanded((open) => !open), []);

  return (
    <Box
      className="flex-row rounded-xl border border-border bg-card"
      style={{
        paddingLeft: SPACE.md,
        paddingRight: SPACE.md,
        paddingVertical: SPACE.md,
        borderRadius: RADIUS.md,
      }}
    >
      <Box style={{ width: LIVE_TV.scheduleTimeWidth }} className="justify-start">
        <StreamZText variant="body" className="text-foreground" numberOfLines={1}>
          {timeLabel}
        </StreamZText>
      </Box>

      <VStack className="ml-2 flex-1">
        <StreamZText
          variant="cardTitle"
          numberOfLines={2}
          maxFontSizeMultiplier={LIVE_TV.rowMaxFontScale}
          className="text-foreground"
        >
          {event.title}
        </StreamZText>

        {listings.length ? (
          <VStack
            className="mt-2 rounded-lg border border-border"
            style={{ borderRadius: RADIUS.sm }}
          >
            {listings.map(({ reference, channel }, index) => (
              <LiveTvPressable
                key={reference.id}
                onPress={() => onOpen(channel)}
                accessibilityLabel={playControlLabel(reference.name)}
                className={`flex-row items-center px-2 ${
                  index > 0 ? 'border-t border-border' : ''
                }`}
                focusedClassName={`bg-primary/10 ${TV_FOCUS_BORDER_CLASSNAME}`}
                pressedStyle={{ backgroundColor: SURFACE.high }}
                style={{ minHeight: LIVE_TV.rowActionTarget }}
              >
                <ChannelLogo name={channel.name} logoUrl={channel.logoUrl} tile={24} />
                <StreamZText
                  variant="caption"
                  numberOfLines={1}
                  maxFontSizeMultiplier={LIVE_TV.rowMaxFontScale}
                  className="ml-2 flex-1"
                >
                  {reference.name}
                </StreamZText>
                {resolvingId === reference.id ? (
                  <Spinner size="small" color={BRAND_COLOR.primary} />
                ) : null}
              </LiveTvPressable>
            ))}
            {hasHiddenEventChannels(channels.length) ? (
              <LiveTvPressable
                onPress={toggleAll}
                accessibilityLabel={
                  expanded
                    ? `Show fewer channels for ${event.title}`
                    : `Show all ${formatCount(channels.length)} channels for ${event.title}`
                }
                className="flex-row items-center border-t border-border px-2"
                focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
                pressedStyle={{ backgroundColor: SURFACE.high }}
                style={{ minHeight: LIVE_TV.rowActionTarget }}
              >
                <Icon
                  as={expanded ? ChevronUp : ChevronDown}
                  size="sm"
                  className="text-muted-foreground"
                />
                <StreamZText variant="caption" numberOfLines={1} className="ml-2">
                  {expanded ? 'Show fewer' : `Show all ${formatCount(channels.length)} channels`}
                </StreamZText>
              </LiveTvPressable>
            ) : null}
          </VStack>
        ) : null}
      </VStack>
    </Box>
  );
});

/** The group line above a run of listings: what the section is, and how many are in it. */
export const LiveTvSectionHeader = ({
  name,
  eventCount,
}: {
  name: string;
  eventCount: number;
}) => (
  <HStack className="items-end justify-between" style={{ paddingTop: SPACE.sm }}>
    <StreamZText
      variant="sectionTitle"
      numberOfLines={1}
      maxFontSizeMultiplier={1.3}
      className="text-foreground"
    >
      {name}
    </StreamZText>
    <StreamZText variant="metadata" numberOfLines={1} accessibilityLabel={`${formatCount(eventCount)} listings`}>
      {formatCount(eventCount)}
    </StreamZText>
  </HStack>
);
