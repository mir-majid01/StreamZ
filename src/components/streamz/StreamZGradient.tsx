import React from 'react';
import { LinearGradient, type LinearGradientProps } from 'expo-linear-gradient';
import { GRADIENT } from '@/src/theme/tokens';

/**
 * Gradient presets from the token layer (PRD §9). `accent` is the brand ramp —
 * reserve it for primary CTA, active states, highlights and logo treatments;
 * `scrim` melts imagery into the dark background.
 */
export type StreamZGradientProps = Omit<LinearGradientProps, 'colors'> & {
  preset?: keyof typeof GRADIENT;
};

export const StreamZGradient = ({ preset = 'accent', ...props }: StreamZGradientProps) => (
  <LinearGradient colors={[...GRADIENT[preset]]} {...props} />
);
