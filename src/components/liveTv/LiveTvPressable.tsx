import { useState, type ReactNode } from 'react';
import type { Insets, StyleProp, ViewStyle } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { isTV } from '@/src/utils/tv';

interface LiveTvPressableProps {
  children: ReactNode;
  onPress?: () => void;
  className?: string;
  /** Applied only while the element holds TV focus, exactly like `Focusable`. */
  focusedClassName?: string;
  /**
   * Painted while the finger is down. Applied through local state rather than
   * `Pressable`'s style callback — see the note on `style` below.
   */
  pressedStyle?: ViewStyle;
  hitSlop?: Insets | number;
  accessibilityLabel?: string;
  /** `tab` for the navigation track, `button` for filters and rows. */
  role?: 'button' | 'tab';
  /** Carried as `accessibilityState.selected`, so TalkBack says which option is on. */
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The screen's pressable. `Focusable` covers phone press and TV focus, but its prop
 * list cannot carry `accessibilityRole` or `accessibilityState`, and a segmented
 * control whose selected option is not announced is not accessible — so this wraps
 * the same primitives (`ui/pressable`, `TV_FOCUS_BORDER_CLASSNAME`, `isTV`) with
 * those two props added.
 *
 * Requested change, not made here: give `Focusable` these props and delete this.
 */
export const LiveTvPressable = ({
  children,
  onPress,
  className,
  focusedClassName,
  pressedStyle,
  hitSlop,
  accessibilityLabel,
  role = 'button',
  selected,
  disabled,
  style,
}: LiveTvPressableProps) => {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      focusable
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      // `style` must not be a function. This element also carries a `className`, so
      // react-native-css merges the two by putting both into one array — and a
      // callback nested in an array is dropped when React Native flattens the
      // style. Every pressable on this screen silently lost its padding, its
      // minimum height and its 44dp touch target until this line stopped
      // using the callback form.
      style={[pressed && !disabled ? pressedStyle : undefined, style]}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      className={`${className ?? ''} ${isTV && focused ? (focusedClassName ?? '') : ''}`}
    >
      {children}
    </Pressable>
  );
};
