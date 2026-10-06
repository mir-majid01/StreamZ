import React from 'react';
import { ActivityIndicator } from 'react-native';
import { StreamZPressable, type StreamZPressableProps } from './StreamZPressable';
import { StreamZText } from './StreamZText';
import { StreamZGradient } from './StreamZGradient';
import { OPACITY, RADIUS } from '@/src/theme/tokens';

/**
 * The one button (PRD §18, §38). `accent` is the gradient CTA — the reserved
 * brand ramp; `solid` is flat primary for dense UI; `google` follows Google's
 * sign-in branding (white surface, dark label, the four-colour G leads).
 * Loading swaps content for a spinner and swallows further taps; callers never
 * hand-roll a busy state.
 */
export type StreamZButtonVariant = 'accent' | 'solid' | 'ghost' | 'outline' | 'google';

export type StreamZButtonProps = Omit<StreamZPressableProps, 'children'> & {
  variant?: StreamZButtonVariant;
  loading?: boolean;
  icon?: React.ReactNode;
  label: string;
};

const LABEL_COLOR: Record<StreamZButtonVariant, string> = {
  accent: 'text-white',
  solid: 'text-white',
  ghost: 'text-foreground',
  outline: 'text-foreground',
  google: 'text-[#1F1F1F]',
};

const WRAPPER_CLASS: Record<StreamZButtonVariant, string> = {
  accent: '',
  solid: 'bg-primary',
  ghost: 'bg-transparent',
  outline: 'border border-border bg-transparent',
  google: 'bg-white',
};

export const StreamZButton = ({
  variant = 'accent',
  loading = false,
  icon,
  label,
  disabled,
  className,
  ...props
}: StreamZButtonProps) => {
  const isDisabled = disabled === true || loading;
  const height = 52;

  const core = (
    <StreamZPressable
      disabled={isDisabled}
      className={`h-[52px] flex-row items-center justify-center rounded-2xl px-6 ${WRAPPER_CLASS[variant]} ${className ?? ''}`}
      style={isDisabled ? { opacity: OPACITY.disabled } : undefined}
      {...props}
    >
      {loading ? (
        <>
          <ActivityIndicator size="small" color={variant === 'google' ? '#1F1F1F' : '#FFFFFF'} />
          <StreamZText variant="button" className={`${LABEL_COLOR[variant]} ml-3`}>
            {label}
          </StreamZText>
        </>
      ) : (
        <>
          {icon}
          <StreamZText variant="button" className={`${LABEL_COLOR[variant]} ${icon ? 'ml-3' : ''}`}>
            {label}
          </StreamZText>
        </>
      )}
    </StreamZPressable>
  );

  if (variant !== 'accent') return core;

  // The accent ramp wraps the pressable so the gradient never scales — only
  // the hit surface does, keeping the highlight visually stable.
  return (
    <StreamZGradient
      preset="accent"
      start={{ x: 0, y: 0.5 }}
      end={{ x: 1, y: 0.5 }}
      style={{ height, borderRadius: RADIUS.lg, opacity: isDisabled ? OPACITY.disabled : 1 }}
    >
      {core}
    </StreamZGradient>
  );
};
