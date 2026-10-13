import { StyleSheet } from 'react-native';
import { Lock, LockOpen } from 'lucide-react-native';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Focusable } from '@/src/components/Focusable';
import { TV_FOCUS_BORDER_CLASSNAME } from '@/src/utils/tv';

interface PlayerLockOverlayProps {
  onUnlock: () => void;
}

/**
 * The entire locked-mode chrome. Mounted instead of `PlayerControls`, so the
 * transport, scrub bar, sliders and drawers are not merely dimmed — they are
 * not there to be pressed.
 *
 * No scrim: a locked screen still has to show the picture, and a full-screen
 * layer would also sit between the video and anyone using magnification or a
 * screen reader. Unlock is held by this component rather than by the controls,
 * because it is the one affordance that must never be reachable only by
 * interaction we have just disabled.
 */
export const PlayerLockOverlay = ({ onUnlock }: PlayerLockOverlayProps) => (
  <Box style={StyleSheet.absoluteFill} className="z-40" pointerEvents="box-none">
    <Box className="absolute left-4 top-0 bottom-0 justify-center">
      <Focusable
        onPress={onUnlock}
        hasTVPreferredFocus
        hitSlop={16}
        className="rounded-full bg-background/60 py-3 pl-3 pr-4 border border-background/30"
        focusedClassName={`bg-primary/30 ${TV_FOCUS_BORDER_CLASSNAME}`}
      >
        <HStack space="sm" className="items-center">
          <Icon as={LockOpen} size="md" className="text-foreground" />
          <Text size="sm" bold className="text-foreground">
            Unlock
          </Text>
        </HStack>
      </Focusable>
      <HStack space="xs" className="items-center mt-2 pl-1">
        <Icon as={Lock} size="sm" className="text-muted-foreground" />
        <Text size="xs" className="text-muted-foreground">
          Controls locked
        </Text>
      </HStack>
    </Box>
  </Box>
);
