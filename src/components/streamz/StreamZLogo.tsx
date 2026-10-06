import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { HStack } from '@/components/ui/hstack';
import { StreamZText } from './StreamZText';
import { FONT } from '@/src/theme/tokens';

/**
 * StreamZ identity (PRD §10). The Z is the brand element: a geometric stroke-Z
 * whose diagonal overshoots both bars — the "stream" cutting through. The
 * wordmark pairs it with the display face so the lockup reads as one designed
 * mark at any size. `mono` renders a single-colour mark for one-colour
 * surfaces; the default carries the accent ramp on the diagonal only.
 */
export const StreamZZMark = ({
  size = 28,
  mono = false,
  color = '#FFFFFF',
  accent = true,
}: {
  size?: number;
  mono?: boolean;
  color?: string;
  accent?: boolean;
}) => {
  if (mono || !accent) {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" accessible={false}>
        <Path
          d="M14 12 H50 M50 8 L14 54 M14 52 H50"
          stroke={color}
          strokeWidth={9}
          strokeLinecap="butt"
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none" accessible={false}>
      <Defs>
        <LinearGradient id="streamzZ" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF3045" />
          <Stop offset="0.55" stopColor="#E50914" />
          <Stop offset="1" stopColor="#B20710" />
        </LinearGradient>
      </Defs>
      {/* Bars in surface colour; the diagonal carries the accent ramp. */}
      <Path d="M14 12 H50 M14 52 H50" stroke={color} strokeWidth={9} strokeLinecap="butt" />
      <Path d="M54 6 L12 56" stroke="url(#streamzZ)" strokeWidth={11} strokeLinecap="round" />
    </Svg>
  );
};

export const StreamZLogo = ({
  size = 28,
  mono = false,
  color = '#FFFFFF',
}: {
  /** Cap height of the wordmark text; the Z scales to match. */
  size?: number;
  mono?: boolean;
  color?: string;
}) => (
  <HStack className="items-center" space="xs">
    <StreamZText
      style={{
        fontFamily: FONT.display,
        fontSize: size,
        lineHeight: size * 1.1,
        color,
        letterSpacing: -0.5,
      }}
    >
      Stream
    </StreamZText>
    <StreamZZMark size={size * 1.02} color={color} accent={!mono} />
  </HStack>
);
