import { store } from '../storage/store';
import { isPro } from '../billing/pro';
import AppBlocker from '../native/AppBlocker';
import { blockedPackagesOf, Task, isEffectiveStrict } from '../types';

/**
 * Wave 2C2 owl loss-state mood for the widget (additive).
 * Derived from give-ins today: 'bright' (0) | 'steady' (1-2) | 'wilted' (>2).
 * Exported for the backend agent's native mirror; mirrors mascot.ts
 * widgetMoodForGiveIns without importing theme art into the sync path.
 */
export function widgetMascotMood(giveInsToday: number): 'bright' | 'steady' | 'wilted' {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? giveInsToday : 0;
  if (n > 2) return 'wilted';
  if (n >= 1) return 'steady';
  return 'bright';
}

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
    const [sessions, streak, prefs, tasks, giveInsToday] = await Promise.all([
      store.getSessions(),
      store.getStreak(),
      store.getPreferences(),
      store.getTasks(),
      store.getGiveInsToday(),
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
    const strictActive = isEffectiveStrict(activeTask?.strict, prefs.dumfoundMode);
    const lastPackages =
      lastTask != null
        ? blockedPackagesOf(lastTask)
        : activeTask
          ? blockedPackagesOf(activeTask)
          : [];
    // Wave 2C2 / feature 4: mascotMood ('bright'|'steady'|'wilted') rides the
    // optional 9th syncWidgetData param. AppBlocker.ts falls back to the
    // 8-arg shell on stale natives, so this is safe to always pass.
    await AppBlocker.syncWidgetData({
      todayFocusMin,
      streak,
      subscribed: isPro(prefs),
      lastPackages,
      sessionActive,
      strictActive,
      activeTaskName: activeTask?.name ?? null,
      giveInsToday,
      mascotMood: widgetMascotMood(giveInsToday),
    }).catch(() => {});
  } catch {
    // Best-effort.
  }
}
