import { Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';
import { store } from './storage/store';

/**
 * Single haptics seam: real tactile feedback honoring the Settings toggle.
 * Fire-and-forget — never await in press handlers. expo-haptics first
 * (needs a rebuilt native shell); built-in Vibration as the fallback.
 */
export function tap(feel: 'light' | 'medium' = 'light'): void {
  store
    .getPreferences()
    .then(p => {
      if (p.hapticFeedback === false) return;
      const style =
        feel === 'medium'
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light;
      Haptics.impactAsync(style).catch(() => {
        Vibration.vibrate(feel === 'medium' ? 25 : 12);
      });
    })
    .catch(() => {});
}
