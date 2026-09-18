import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Fires `onActive` every time the app returns to the foreground after being
 * inactive/backgrounded. Navigation focus does NOT change on a home/recents
 * return (the same screen stays focused), so `useFocusEffect` alone never
 * re-runs there — this is the seam every return target uses to re-hydrate
 * store state and snap reanimated entry values to their end state.
 * Best-effort: the callback must never throw (it runs outside render).
 */
export function useOnForeground(onActive: () => void): void {
  const cbRef = useRef(onActive);
  cbRef.current = onActive;

  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', next => {
      try {
        if (prev.match(/inactive|background/) && next === 'active') {
          cbRef.current();
        }
      } catch {
        // Best-effort; a refresh failure must never crash the return path.
      } finally {
        prev = next;
      }
    });
    return () => sub.remove();
  }, []);
}
