import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task, Session, BlockedAttempt, FocusSchedule, UserPreferences } from '../types';

const TASKS_KEY = '@stayt_tasks';
const SESSIONS_KEY = '@stayt_sessions';
const PREFERENCES_KEY = '@stayt_preferences';
const BLOCKED_ATTEMPTS_KEY = '@stayt_blocked_attempts';
const SCHEDULES_KEY = '@stayt_schedules';
const OVERRIDES_KEY = '@stayt_override_budget';

/** Max 2-min overrides per calendar day (anti-abuse budget). */
export const MAX_DAILY_OVERRIDES = 3;

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Serialize read-modify-write cycles per key so concurrent saves can't interleave.
const writeChains = new Map<string, Promise<unknown>>();
function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = (prev as Promise<void>).then(fn, fn);
  writeChains.set(key, next.catch(() => {}));
  return next;
}

export const store = {
  // Tasks
  async getTasks(): Promise<Task[]> {
    const data = await AsyncStorage.getItem(TASKS_KEY);
    return safeParse<Task[]>(data, []);
  },

  async saveTask(task: Task): Promise<void> {
    return serialized(TASKS_KEY, async () => {
      const tasks = await this.getTasks();
      const index = tasks.findIndex(t => t.id === task.id);
      if (index >= 0) {
        tasks[index] = task;
      } else {
        tasks.push(task);
      }
      await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    });
  },

  async deleteTask(taskId: string): Promise<void> {
    return serialized(TASKS_KEY, async () => {
      const tasks = await this.getTasks();
      const filtered = tasks.filter(t => t.id !== taskId);
      await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(filtered));
    });
  },

  // Sessions
  async getSessions(): Promise<Session[]> {
    const data = await AsyncStorage.getItem(SESSIONS_KEY);
    return safeParse<Session[]>(data, []);
  },

  async saveSession(session: Session): Promise<void> {
    return serialized(SESSIONS_KEY, async () => {
      const sessions = await this.getSessions();
      const index = sessions.findIndex(s => s.id === session.id);
      if (index >= 0) {
        sessions[index] = session;
      } else {
        sessions.push(session);
      }
      // Cap history so storage can't grow unbounded.
      const capped = sessions.slice(-500);
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(capped));
    });
  },

  async getActiveSession(): Promise<Session | null> {
    const sessions = await this.getSessions();
    return sessions.find(s => s.status === 'active') || null;
  },

  async clearSessions(): Promise<void> {
    return serialized(SESSIONS_KEY, async () => {
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify([]));
    });
  },

  // Preferences
  async getPreferences(): Promise<UserPreferences> {
    const data = await AsyncStorage.getItem(PREFERENCES_KEY);
    return safeParse<UserPreferences | null>(data, null) ?? {
      themeMode: 'system',
      notificationsEnabled: true,
      hapticFeedback: true,
      freeTaskLimit: 1,
      hasOnboarded: false,
      isSubscribed: false,
    };
  },

  async savePreferences(prefs: UserPreferences): Promise<void> {
    // Serialized: concurrent get→spread→set cycles (toggles, grantPro) must not clobber each other.
    return serialized(PREFERENCES_KEY, async () => {
      await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    });
  },

  // Preset tasks for first launch
  async seedPresetTasks(): Promise<void> {
    const tasks = await this.getTasks();
    if (tasks.length > 0) return;

    const presets: Task[] = [
      {
        id: 'preset-deep-work',
        name: 'Deep Work',
        packageName: 'com.instagram.android',
        appName: 'Instagram',
        createdAt: Date.now(),
        lastUsed: 0,
        useCount: 0,
        isActive: true,
        streak: 0,
        isPreset: true,
      },
      {
        id: 'preset-writing',
        name: 'Writing',
        packageName: 'com.twitter.android',
        appName: 'X (Twitter)',
        createdAt: Date.now(),
        lastUsed: 0,
        useCount: 0,
        isActive: true,
        streak: 0,
        isPreset: true,
      },
      {
        id: 'preset-studying',
        name: 'Studying',
        packageName: 'com.google.android.youtube',
        appName: 'YouTube',
        createdAt: Date.now(),
        lastUsed: 0,
        useCount: 0,
        isActive: true,
        streak: 0,
        isPreset: true,
      },
    ];

    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(presets));
  },

  // Blocked Attempts
  async getBlockedAttempts(): Promise<BlockedAttempt[]> {
    const data = await AsyncStorage.getItem(BLOCKED_ATTEMPTS_KEY);
    return safeParse<BlockedAttempt[]>(data, []);
  },

  async saveBlockedAttempt(attempt: BlockedAttempt): Promise<void> {
    return serialized(BLOCKED_ATTEMPTS_KEY, async () => {
      const attempts = await this.getBlockedAttempts();
      attempts.push(attempt);
      await AsyncStorage.setItem(BLOCKED_ATTEMPTS_KEY, JSON.stringify(attempts.slice(-1000)));
    });
  },

  async clearBlockedAttempts(): Promise<void> {
    return serialized(BLOCKED_ATTEMPTS_KEY, async () => {
      await AsyncStorage.setItem(BLOCKED_ATTEMPTS_KEY, JSON.stringify([]));
    });
  },

  // Focus schedules (Pro)
  async getSchedules(): Promise<FocusSchedule[]> {
    const data = await AsyncStorage.getItem(SCHEDULES_KEY);
    return safeParse<FocusSchedule[]>(data, []);
  },

  async saveSchedule(schedule: FocusSchedule): Promise<void> {
    return serialized(SCHEDULES_KEY, async () => {
      const all = await this.getSchedules();
      const index = all.findIndex(s => s.id === schedule.id);
      if (index >= 0) {
        all[index] = schedule;
      } else {
        all.push(schedule);
      }
      await AsyncStorage.setItem(SCHEDULES_KEY, JSON.stringify(all));
    });
  },

  async deleteSchedule(scheduleId: string): Promise<void> {
    return serialized(SCHEDULES_KEY, async () => {
      const all = await this.getSchedules();
      await AsyncStorage.setItem(
        SCHEDULES_KEY,
        JSON.stringify(all.filter(s => s.id !== scheduleId)),
      );
    });
  },

  async getSchedulesForTask(taskId: string): Promise<FocusSchedule[]> {
    const all = await this.getSchedules();
    return all.filter(s => s.taskId === taskId);
  },

  async getOverridesUsedToday(): Promise<number> {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY);
    const rec = safeParse<{ date: string; used: number } | null>(raw, null);
    if (!rec || rec.date !== todayKey() || typeof rec.used !== 'number') return 0;
    return Math.max(0, rec.used);
  },

  /**
   * OverrideBudget seam: atomic check-and-consume. The whole read,
   * cap-check, increment, and persist happens inside ONE serialized block,
   * so concurrent double-taps can never both pass or exceed the cap.
   * Returns 'ok' (and the remaining count) or 'exhausted'.
   * This is the ONLY write path for the budget — no other method may
   * increment the count, so JS button and any future caller share one rule.
   */
  async tryConsumeOverride(): Promise<{ result: 'ok' | 'exhausted'; left: number }> {
    return serialized(OVERRIDES_KEY, async () => {
      const raw = await AsyncStorage.getItem(OVERRIDES_KEY);
      const rec = safeParse<{ date: string; used: number } | null>(raw, null);
      const used = rec && rec.date === todayKey() && typeof rec.used === 'number'
        ? Math.max(0, rec.used)
        : 0;
      if (used >= MAX_DAILY_OVERRIDES) {
        return { result: 'exhausted' as const, left: 0 };
      }
      const next = used + 1;
      await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify({ date: todayKey(), used: next }));
      return { result: 'ok' as const, left: Math.max(0, MAX_DAILY_OVERRIDES - next) };
    });
  },

  async getBlockedAttemptsToday(): Promise<BlockedAttempt[]> {
    const attempts = await this.getBlockedAttempts();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return attempts.filter(a => a.timestamp >= todayStart);
  },

  async getStreak(): Promise<number> {
    const todayAttempts = await this.getBlockedAttemptsToday();
    if (todayAttempts.length === 0) return 0;
    
    let streak = 0;
    let currentDate = new Date();
    const allAttempts = await this.getBlockedAttempts();
    
    let maxIterations = 365;
    while (maxIterations-- > 0) {
      const dayStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const hasBlockedAttempt = allAttempts.some(a => a.timestamp >= dayStart && a.timestamp < dayEnd);
      
      if (hasBlockedAttempt) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }
    
    return streak;
  },
};
