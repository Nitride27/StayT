import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { store } from '../storage/store';
import AppBlocker from '../native/AppBlocker';

/**
 * N-2 re-engagement reminders (FREE, expo-notifications, no new deps).
 *
 * ANDROID ONLY (deliberate, <10-line gate): StayT ships Android-first; the
 * scheduler, channel, and copy below are tuned for the Android tray. iOS
 * delivery is intentionally unimplemented — every entry point early-returns
 * off-Android rather than half-working.
 *
 * Policy, exactly as specced:
 * - max 1/day: a single DAILY trigger (09:00 local — outside 22:00–08:00
 *   quiet hours); ensureDailyReminder() first cancels any prior
 *   stayt-reminder so at most one is ever scheduled.
 * - never fires during an active session: the foreground guard dismisses a
 *   received reminder while a session is active (setupReminderGuard, wired
 *   once at boot), and ensureDailyReminder() skips scheduling while a
 *   session is active (session end re-runs it).
 * - master switch is the existing prefs.notificationsEnabled (default ON
 *   after grant, one-tap off in Settings; off cancels the scheduled one).
 * - boot repair: expo-notifications restores scheduled notifications from
 *   its own boot receiver, and App.tsx re-runs ensureDailyReminder() on
 *   every cold start — no new native schedule infra needed.
 */

const CHANNEL_ID = 'stayt_reminders';
const REMINDER_KIND = 'stayt-reminder';
const DAILY_HOUR = 9;
const DAILY_MINUTE = 0;

let handlerSet = false;

/** Must be called once at boot: otherwise scheduled reminders stay silent. */
export function ensureReminderHandler(): void {
  if (Platform.OS !== 'android') return;
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Foreground guard for the never-during-session rule. A DAILY reminder that
 * lands while the user is mid-session is dismissed on receipt instead of
 * shown. Returns an unsubscribe function.
 */
export function setupReminderGuard(): () => void {
  if (Platform.OS !== 'android') return () => {};
  const sub = Notifications.addNotificationReceivedListener(async notification => {
    try {
      if (notification.request.content.data?.kind !== REMINDER_KIND) return;
      const active = await store.getActiveSession();
      if (active) {
        await Notifications.dismissNotificationAsync(notification.request.identifier).catch(
          () => {},
        );
      }
    } catch {
      // Best-effort; a guard failure must never crash the app.
    }
  });
  return () => sub.remove();
}

async function cancelOurs(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter(n => n.content.data?.kind === REMINDER_KIND)
        .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
  } catch {
    // Best-effort.
  }
}

function reminderCopy(streak: number, todayMin: number): { title: string; body: string } {
  if (streak > 0 && todayMin <= 0) {
    return {
      title: `Protect your ${streak}-day streak`,
      body: 'One short focus session today keeps it alive.',
    };
  }
  if (streak > 0) {
    return {
      title: `Streak day ${streak + 1} starts with focus`,
      body: 'Small steps build big progress. Start a session.',
    };
  }
  if (todayMin > 0) {
    return {
      title: 'Nice focus today',
      body: 'One more session locks in the habit.',
    };
  }
  return {
    title: 'Time for a focus session?',
    body: 'Pick a task and StayT will guard your attention.',
  };
}

/**
 * Idempotent: cancels any prior stayt-reminder, then schedules one DAILY
 * 09:00 nudge when (and only when) reminders are enabled, permission is
 * granted, and no session is currently active.
 */
export async function ensureDailyReminder(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const prefs = await store.getPreferences();
    if (!prefs.notificationsEnabled) {
      await cancelOurs();
      return;
    }
    const granted = await AppBlockerIsGranted();
    if (!granted) return;
    const active = await store.getActiveSession();
    if (active) return;
    const [streak, sessions] = await Promise.all([store.getStreak(), store.getSessions()]);
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayMin = Math.floor(
      sessions.reduce(
        (sum, s) =>
          sum +
          (s.status === 'completed' && s.startedAt >= dayStart && (s.duration || 0) > 0
            ? (s.duration as number)
            : 0),
        0,
      ) / 60000,
    );
    const copy = reminderCopy(streak, todayMin);
    await cancelOurs();
    try {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Focus reminders',
        importance: Notifications.AndroidImportance.LOW,
      });
    } catch {
      // Channel create is best-effort; scheduling still works on a default.
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: copy.title,
        body: copy.body,
        data: { kind: REMINDER_KIND },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: DAILY_HOUR,
        minute: DAILY_MINUTE,
        channelId: CHANNEL_ID,
      },
    });
  } catch {
    // Reminders must never break boot or session flows.
  }
}

/** Cancel every stayt-reminder (Settings one-tap off path). */
export async function cancelDailyReminder(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await cancelOurs();
}

// Single seam for the OS permission read: every reminder decision goes
// through the AppBlocker bridge — no direct Notifications.getPermissionsAsync
// anywhere else in app code.
async function AppBlockerIsGranted(): Promise<boolean> {
  try {
    return await AppBlocker.isNotificationPermissionGranted();
  } catch {
    return false;
  }
}
