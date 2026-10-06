import React from 'react';
import { Box } from '@/components/ui/box';
import { StreamZPressable, type StreamZPressableProps } from './StreamZPressable';

/**
 * Surface container on the card token (#111114). Use for grouped content —
 * sheets, list rows, info panels. Interactive cards go through `onPress`,
 * which adds the shared press feedback.
 */
type BoxProps = React.ComponentProps<typeof Box>;

export type StreamZCardProps = BoxProps &
  Pick<StreamZPressableProps, 'onPress' | 'onLongPress' | 'disabled' | 'noScale'>;

export const StreamZCard = ({ onPress, onLongPress, disabled, noScale, className, ...props }: StreamZCardProps) => {
  const classes = 'rounded-2xl border border-border bg-card p-5';
  if (!onPress && !onLongPress) {
    return <Box className={className ? [classes, className].join(' ') : classes} {...props} />;
  }
  return (
    <StreamZPressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      noScale={noScale}
      className={className ? [classes, className].join(' ') : classes}
    >
      <Box className="w-full" {...props} />
    </StreamZPressable>
  );
};
