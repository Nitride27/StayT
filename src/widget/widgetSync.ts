import { store } from '../storage/store';
import AppBlocker from '../native/AppBlocker';
import { blockedPackagesOf, Task } from '../types';

/**
 * P2-1/P2-2 SharedPreferences mirror writer. The home-screen widget and the
 * QS tile read this file directly so they work with the app dead; JS pushes
 * fresh values at every point the underlying data can change:
 * - session start / session end (todayFocusMin, streak, lastPackages,
 *   sessionActive, strictActive)
 * - override/break consume (re-push so the tile never trusts a stale mirror)
 * - Pro grant/restore (subscribed entitlement for the tile)
 * Best-effort throughout — a failed mirror write must never break the flow.
 */
export async function syncWidgetNow(lastTask?: Task | null): Promise<void> {
  try {
    const [sessions, streak, prefs, tasks] = await Promise.all([
      store.getSessions(),
      store.getStreak(),
      store.getPreferences(),
      store.getTasks(),
    ]);
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayFocusMin = Math.floor(
      sessions.reduce(
        (sum, s) =>
          sum +
          (s.status === 'completed' && s.startedAt >= dayStart && (s.duration || 0) > 0
            ? (s.duration as number)
            : 0),
        0,
      ) / 60000,
    );
    // B1: the tile's strict/session gates derive from the live active session,
    // never from a passed-in flag — every push reflects the current truth.
    const active = sessions.find(s => s.status === 'active') ?? null;
    const activeTask = active ? tasks.find(t => t.id === active.taskId) ?? null : null;
    const sessionActive = active != null;
    const strictActive = activeTask?.strict === true;
    const lastPackages =
      lastTask != null
        ? blockedPackagesOf(lastTask)
        : activeTask
          ? blockedPackagesOf(activeTask)
          : [];
    await AppBlocker.syncWidgetData({
      todayFocusMin,
      streak,
      subscribed: prefs.isSubscribed === true,
      lastPackages,
      sessionActive,
      strictActive,
    }).catch(() => {});
  } catch {
    // Best-effort.
  }
}
