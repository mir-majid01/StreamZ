import React from 'react';
import { Text } from '@/components/ui/text';
import { BRAND } from '@/src/config/brand';

/**
 * Wordmark used by the gate screens. Colour comes from brand config only, so the
 * accent stays a single decision (spec §21) even though the value is unchanged.
 */
export const StreamZWordmark = ({ size = 34 }: { size?: number }) => (
  <Text
    className="font-bold tracking-widest"
    style={{ fontSize: size, color: BRAND.accentHex }}
  >
    {BRAND.name}
  </Text>
);
