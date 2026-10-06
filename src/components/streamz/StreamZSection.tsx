import React from 'react';
import { HStack } from '@/components/ui/hstack';
import { Pressable } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { StreamZText } from './StreamZText';
import { ICON_SIZE } from '@/src/theme/tokens';

/**
 * Home-style section header: bold title on the display family, optional
 * "See all" affordance. The action row is only pressable when a handler exists,
 * so screens never render dead controls.
 */
export const StreamZSection = ({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <HStack className="items-center justify-between px-5 pb-3 pt-6">
    <StreamZText variant="sectionTitle" className="text-foreground">
      {title}
    </StreamZText>
    {onAction ? (
      <Pressable
        onPress={onAction}
        accessibilityRole="button"
        accessibilityLabel={actionLabel ?? 'See all'}
        className="flex-row items-center"
      >
        <StreamZText variant="caption" className="text-muted-foreground">
          {actionLabel ?? 'See all'}
        </StreamZText>
        <ChevronRight size={ICON_SIZE.inline} className="ml-1 text-muted-foreground" />
      </Pressable>
    ) : null}
  </HStack>
);
