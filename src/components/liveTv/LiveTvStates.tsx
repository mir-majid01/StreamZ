import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { Icon } from '@/components/ui/icon';
import { StreamZButton } from '@/src/components/streamz/StreamZButton';
import { StreamZText } from '@/src/components/streamz/StreamZText';
import type { LucideIcon } from 'lucide-react-native';
import { RADIUS, SPACE } from '@/src/theme/tokens';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';
import { LiveTvPressable } from './LiveTvPressable';

/**
 * The empty and failure states of the Live TV list.
 *
 * `StreamZStateView` centres itself with `flex-1`, which is right for a screen and
 * meaningless inside a `ListEmptyComponent`, where the parent has no height to fill.
 * This is the same composition — icon tile, title, one explanatory line, one way out
 * — sized by padding so it holds up in a list.
 */
export const LiveTvStateBlock = ({
  icon: Icon_,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <VStack
    className="items-center rounded-2xl border border-border bg-card px-6"
    style={{ borderRadius: RADIUS.lg, paddingVertical: SPACE.xxl, gap: SPACE.sm }}
  >
    <Box
      className="items-center justify-center rounded-2xl bg-muted"
      style={{ width: 56, height: 56, borderRadius: RADIUS.lg }}
    >
      {/* "xl" is the 24dp step of the icon scale, which is `ICON_SIZE.nav`. */}
      <Icon as={Icon_} size="xl" className="text-muted-foreground" />
    </Box>
    <StreamZText variant="sectionTitle" className="text-center text-foreground" numberOfLines={2}>
      {title}
    </StreamZText>
    <StreamZText variant="secondary" className="text-center" numberOfLines={3}>
      {message}
    </StreamZText>
    {actionLabel && onAction ? (
      <StreamZButton
        variant="outline"
        label={actionLabel}
        onPress={onAction}
        className="mt-2 self-stretch"
      />
    ) : null}
  </VStack>
);

/**
 * A problem worth mentioning while the list still has something in it — a channel
 * that would not resolve, a refresh that failed. Same shape Home uses for a
 * half-loaded feed: one line, in a surface, never a raw error.
 */
export const LiveTvNotice = ({
  icon: Icon_,
  message,
  onRetry,
  retryLabel = 'Try again',
}: {
  icon: LucideIcon;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) => (
  <HStack
    className="items-center rounded-lg border border-border bg-card"
    style={{ borderRadius: RADIUS.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm }}
  >
    <Icon as={Icon_} size="sm" className="text-primary" />
    <StreamZText
      variant="secondary"
      numberOfLines={2}
      className="ml-2 flex-1"
    >
      {message}
    </StreamZText>
    {onRetry ? (
      // A text action, not `StreamZButton`: the CTA is 52dp tall by design and would
      // turn a one-line notice into a block. This keeps the row at its own height and
      // still clears the 44dp target.
      <LiveTvPressable
        onPress={onRetry}
        accessibilityLabel={retryLabel}
        className="ml-2 items-center justify-center"
        focusedClassName={TV_FOCUS_BORDER_CLASSNAME}
        style={{ minHeight: 44, paddingHorizontal: SPACE.sm }}
      >
        <StreamZText variant="cardTitle" className="text-primary" numberOfLines={1}>
          {retryLabel}
        </StreamZText>
      </LiveTvPressable>
    ) : null}
  </HStack>
);
