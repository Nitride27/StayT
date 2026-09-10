import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task, Session, BlockedAttempt, UserPreferences } from '../types';

const TASKS_KEY = '@stayt_tasks';
const SESSIONS_KEY = '@stayt_sessions';
const PREFERENCES_KEY = '@stayt_preferences';
const BLOCKED_ATTEMPTS_KEY = '@stayt_blocked_attempts';

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
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
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
