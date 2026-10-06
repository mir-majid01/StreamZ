import React from 'react';
import { VStack } from '@/components/ui/vstack';
import { CloudOff, Clapperboard, type LucideIcon } from 'lucide-react-native';
import { StreamZText } from './StreamZText';
import { StreamZButton } from './StreamZButton';
import { ICON_SIZE } from '@/src/theme/tokens';

/**
 * Designed failure and emptiness (PRD §41): every dead end in the app renders
 * one of these — never a raw error, never a stack trace, never a blank screen.
 * The icon is decorative; the title carries the meaning so color is not the
 * only channel (§42).
 */
export const StreamZStateView = ({
  icon: Icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <VStack space="md" className="flex-1 items-center justify-center px-8">
    <VStack className="mb-2 h-16 w-16 items-center justify-center rounded-3xl bg-muted">
      <Icon size={ICON_SIZE.nav} className="text-muted-foreground" />
    </VStack>
    <StreamZText variant="sectionTitle" className="text-center text-foreground">
      {title}
    </StreamZText>
    {message ? (
      <StreamZText variant="secondary" className="text-center text-muted-foreground">
        {message}
      </StreamZText>
    ) : null}
    {actionLabel && onAction ? (
      <StreamZButton variant="outline" label={actionLabel} onPress={onAction} className="mt-3 px-8" />
    ) : null}
  </VStack>
);

export const StreamZErrorState = (props: Omit<Parameters<typeof StreamZStateView>[0], 'icon'>) => (
  <StreamZStateView icon={CloudOff} {...props} />
);

export const StreamZEmptyState = (props: Omit<Parameters<typeof StreamZStateView>[0], 'icon'>) => (
  <StreamZStateView icon={Clapperboard} {...props} />
);
