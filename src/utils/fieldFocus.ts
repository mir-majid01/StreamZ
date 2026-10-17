import type { RefObject } from 'react';

/**
 * The slice of a text input this module needs. `TextInput`'s imperative handle
 * satisfies it (RN exposes `blur`, `focus`, `isFocused`), and so does a fake in
 * a unit test, which is why this does not import React Native at all.
 */
export interface BlurableField {
  blur?: () => void;
  isFocused?: () => boolean;
}

/**
 * The handle a React Native `TextInput` actually hands back through a ref: both
 * methods present. Type a `useRef` as this when you know the ref is forwarded to
 * a real input, and pass it to `releaseFieldFocus` as a `BlurableField`.
 */
export type FieldHandle = Required<BlurableField>;

/**
 * Release a text field the app is about to leave.
 *
 * Why the app has to ask for this instead of getting it for free:
 *
 *   - On Android the soft keyboard follows the *view* that holds focus, and RN
 *     only hides it when that view is explicitly cleared: `ReactEditText`
 *     (`react-native/ReactAndroid/.../textinput/ReactEditText.kt`) shows the IME
 *     from `requestFocusProgrammatically()` and hides it from
 *     `clearFocusAndMaybeRefocus()`. Nothing calls the latter on navigation.
 *   - `react-native-screens` then *protects* that focus across transitions. Its
 *     screen wrapper overrides `clearFocus()` to do nothing while the view is
 *     `INVISIBLE` — the code comment says it exists so `autoFocus` survives a
 *     fragment transition — and `ScreenStackFragment.onStart()` re-requests focus
 *     on `lastFocusedChild`. So a field the user last typed in stays the IME
 *     target after the app pushes another screen over it (Detail, then the
 *     Player, which rotates the window), and the keyboard can surface with no
 *     tap behind it.
 *
 * Blurring is the precise fix, and it is the one that keeps search behaving
 * normally: the field is still focusable, still shows the keyboard when the user
 * taps it, and `keyboardShouldPersistTaps` / `showSoftInputOnFocus` are left at
 * their defaults.
 *
 * Returns `true` when a field actually held focus and was released, so callers
 * (and tests) can tell a real release from a no-op.
 */
export function releaseFieldFocus(field: BlurableField | null | undefined): boolean {
  if (!field) return false;
  // A handle without `isFocused` (older ref, or a partially-mounted input) is
  // treated as holding focus: `blur()` on an unfocused field is a no-op, so the
  // conservative reading costs nothing and still clears the keyboard when the
  // field genuinely did have it.
  const held = typeof field.isFocused === 'function' ? field.isFocused() === true : true;
  if (!held) return false;
  field.blur?.();
  return true;
}

/** Same thing through a ref, for call sites that hold a `useRef`. */
export function releaseFieldFocusRef(ref: RefObject<BlurableField | null>): boolean {
  return releaseFieldFocus(ref.current);
}
