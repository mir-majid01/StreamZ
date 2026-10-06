import React from 'react';
import type { TextStyle } from 'react-native';
import { Text as GSText } from '@/components/ui/text';
import { FONT, TYPE_SIZE } from '@/src/theme/tokens';

/**
 * The typography system (PRD §11). One component, eleven variants — screens must
 * never set a fontSize directly. Colour stays a Tailwind semantic class so the
 * CSS-variable theme remains the single color authority; variants only pin the
 * family/size/tracking trio that comes from the type scale.
 */
export type StreamZTextVariant =
  | 'display'
  | 'hero'
  | 'screenTitle'
  | 'sectionTitle'
  | 'cardTitle'
  | 'body'
  | 'secondary'
  | 'caption'
  | 'metadata'
  | 'button'
  | 'nav';

const VARIANT_STYLES: Record<StreamZTextVariant, TextStyle> = {
  display: {
    fontFamily: FONT.display,
    fontSize: TYPE_SIZE.hero + 4,
    letterSpacing: 0.3,
  },
  hero: { fontFamily: FONT.display, fontSize: TYPE_SIZE.hero },
  screenTitle: { fontFamily: FONT.displayMedium, fontSize: TYPE_SIZE.screenTitle },
  sectionTitle: { fontFamily: FONT.displayMedium, fontSize: TYPE_SIZE.sectionTitle },
  cardTitle: { fontFamily: FONT.bodySemiBold, fontSize: TYPE_SIZE.cardTitle },
  body: { fontFamily: FONT.body, fontSize: TYPE_SIZE.body },
  secondary: { fontFamily: FONT.body, fontSize: TYPE_SIZE.secondary },
  caption: { fontFamily: FONT.bodyMedium, fontSize: TYPE_SIZE.caption },
  metadata: { fontFamily: FONT.bodyMedium, fontSize: TYPE_SIZE.metadata },
  button: { fontFamily: FONT.bodySemiBold, fontSize: TYPE_SIZE.button },
  nav: { fontFamily: FONT.bodyMedium, fontSize: TYPE_SIZE.nav },
};

const VARIANT_COLOR: Partial<Record<StreamZTextVariant, string>> = {
  secondary: 'text-muted-foreground',
  caption: 'text-muted-foreground',
  metadata: 'text-muted-foreground',
  nav: 'text-muted-foreground',
};

export type StreamZTextProps = React.ComponentProps<typeof GSText> & {
  variant?: StreamZTextVariant;
};

export const StreamZText = ({ variant = 'body', className, style, ...props }: StreamZTextProps) => {
  const colorClass = VARIANT_COLOR[variant];
  return (
    <GSText
      className={colorClass ? [colorClass, className].filter(Boolean).join(' ') : className}
      style={[VARIANT_STYLES[variant], style]}
      {...props}
    />
  );
};
