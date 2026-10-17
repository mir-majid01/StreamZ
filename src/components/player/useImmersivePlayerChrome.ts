import { useEffect } from 'react';
import { Platform, StatusBar } from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { forceLandscape, restoreOrientation } from '@/src/utils/orientation';

/** The one navigation method this hook uses, typed narrowly so a test can fake it. */
export type PlayerChromeNavigation = Pick<NavigationProp<ParamListBase>, 'addListener'>;

/**
 * Take the window over for playback: landscape, and on Android both system bars gone.
 *
 * Idempotent by design — locking to a landscape the window already holds and `setHidden(true)`
 * twice are both no-ops — because the give-back below may legitimately run twice for one screen.
 */
export function takePlayerChrome(): void {
  void forceLandscape();
  if (Platform.OS === 'android') {
    void NavigationBar.setHidden(true);
  }
}

/**
 * Hand the window back: default orientation, and on Android both system bars visible again.
 *
 * The status bar needs the imperative call. The declarative `<StatusBar hidden />` in the player
 * *should* undo itself on unmount, but on Android its hidden state can survive the pop, which
 * reports downstream as `insets.top === 0` and shifts the Home header and the tab bar up — the
 * same "something moved under my thumb on the way out of playback" family as the navigation bar.
 */
export function giveBackPlayerChrome(): void {
  void restoreOrientation();
  if (Platform.OS === 'android') {
    void NavigationBar.setHidden(false);
    StatusBar.setHidden(false, 'fade');
  }
}

/**
 * The full-screen player's effect on the window, and all of it given back on the way out.
 *
 * Why this is a hook and not inline in each screen, and why it listens to `beforeRemove`:
 *
 * Both players used to restore the chrome in the cleanup of a `useEffect` with an empty dep list.
 * That cleanup runs when the screen is *destroyed*, and `react-native-screens` destroys a popped
 * screen after the dismiss transition has been asked to run — so the window went back to portrait
 * and the system bars came back while the previous screen was already cross-fading into view.
 * `animation: 'fade'` on `Player`/`LivePlayer` (`src/navigation/AppNavigator.tsx`) means the
 * revealed tab bar is on screen during that moment, and its height comes from `insets.bottom`,
 * which changes as the navigation bar returns. The result is the tab bar re-laying itself out
 * under the user's thumb: the reported "the bottom-tab selector glitches after leaving playback".
 *
 * `beforeRemove` is the navigation event that *starts* the exit. Doing the work there means the
 * insets have settled by the time the previous screen becomes visible, which is the difference
 * between a lifecycle fix and a `setTimeout` guessed at the animation's length. The unmount
 * cleanup stays as the safety net, because a screen can also be destroyed without a pop — the
 * session gate calls `navigationRef.reset(...)`, which tears the stack down with no `beforeRemove`
 * for the popped screen — and a player left holding a landscape lock would be worse than a
 * restore that ran twice.
 */
export function useImmersivePlayerChrome(navigation: PlayerChromeNavigation): void {
  useEffect(() => {
    takePlayerChrome();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', () => {
      giveBackPlayerChrome();
    });
    return () => {
      unsubscribe();
      giveBackPlayerChrome();
    };
  }, [navigation]);
}
