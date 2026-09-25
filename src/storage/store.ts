import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task, Session, BlockedAttempt, FocusSchedule, UserPreferences, Budget, BlockedDomain, FeedFilter, blockedPackagesOf } from '../types';

const TASKS_KEY = '@stayt_tasks';
const SESSIONS_KEY = '@stayt_sessions';
const PREFERENCES_KEY = '@stayt_preferences';
const BLOCKED_ATTEMPTS_KEY = '@stayt_blocked_attempts';
const SCHEDULES_KEY = '@stayt_schedules';
const OVERRIDES_KEY = '@stayt_override_budget';
const BUDGETS_KEY = '@stayt_budgets';
const BLOCKED_DOMAINS_KEY = '@stayt_blocked_domains';
const FEED_FILTERS_KEY = '@stayt_feed_filters';

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

/**
 * Crash-hardening seam for every list read: AsyncStorage can hold anything
 * (corrupt JSON, a dict where a list belongs, null rows from a killed
 * write). safeParse only covers null/malformed-JSON — a parsed non-array or
 * null rows would crash every downstream .find/.filter/.map. This coerces to
 * a dense array of objects so readers never deref null.
 */
function asArray<T extends object>(v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).filter(
    (e): e is T => e != null && typeof e === 'object',
  );
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
    return asArray<Task>(safeParse<Task[] | null>(data, null));
  },

  async saveTask(task: Task): Promise<void> {
    await serialized(TASKS_KEY, async () => {
      const tasks = await this.getTasks();
      const index = tasks.findIndex(t => t.id === task.id);
      if (index >= 0) {
        tasks[index] = task;
      } else {
        tasks.push(task);
      }
      await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    });
    // Task blockedPackages are hard-block sources: any feed entry now
    // colliding is auto-disabled (hard block wins). Best-effort; the task
    // itself already saved. Callers re-push native feeds after this.
    try {
      await this.reconcileFeedCollisions();
    } catch {
      // Best-effort.
    }
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
    return asArray<Session>(safeParse<Session[] | null>(data, null));
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
    const defaults: UserPreferences = {
      themeMode: 'system',
      notificationsEnabled: true,
      hapticFeedback: true,
      freeTaskLimit: 1,
      hasOnboarded: false,
      isSubscribed: false,
    };
    const data = await AsyncStorage.getItem(PREFERENCES_KEY);
    const parsed = safeParse<Partial<UserPreferences> | null>(data, null);
    // A parsed non-object (number/string/array from a corrupt write) must not
    // reach callers as "preferences" — merge over defaults so every field
    // exists with a usable type. Leaf values ride through as stored.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaults;
    return { ...defaults, ...parsed };
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
    return asArray<BlockedAttempt>(safeParse<BlockedAttempt[] | null>(data, null));
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

  /**
   * M1 stats fix: each block must yield exactly one record. The entry path
   * logs a 'give_in'; an override/break/friction_pass for the same package
   * replaces it — delete the most recent unmatched 'give_in' for that
   * package so resists (action != 'override') stay exact. Best-effort; never
   * throws. Only 'give_in' rows are ever deleted — a 'friction_pass' row is
   * terminal and must never be removed here.
   */
  async deleteLatestGiveIn(packageName: string): Promise<void> {
    return serialized(BLOCKED_ATTEMPTS_KEY, async () => {
      const attempts = await this.getBlockedAttempts();
      for (let i = attempts.length - 1; i >= 0; i--) {
        if (attempts[i].packageName === packageName && attempts[i].action === 'give_in') {
          attempts.splice(i, 1);
          break;
        }
      }
      await AsyncStorage.setItem(BLOCKED_ATTEMPTS_KEY, JSON.stringify(attempts.slice(-1000)));
    });
  },

  // Focus schedules (Pro)
  async getSchedules(): Promise<FocusSchedule[]> {
    const data = await AsyncStorage.getItem(SCHEDULES_KEY);
    return asArray<FocusSchedule>(safeParse<FocusSchedule[] | null>(data, null));
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
    // Dumfound: frozen at the enable-time snapshot — blocks during dumfound
    // log nothing, so without this the display would decay to 0 (streak loss).
    try {
      const prefs = await this.getPreferences();
      if (prefs.dumfoundMode === true) return Math.max(0, prefs.dumfoundStreak ?? 0);
    } catch {
      // Fall through to the live computation.
    }
    // A streak stays alive until today ends: with nothing logged yet today
    // (e.g. just past midnight) it counts back from yesterday instead of 0.
    const allAttempts = await this.getBlockedAttempts();
    const hasActivity = (day: Date) => {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      return allAttempts.some(a => a.timestamp >= start && a.timestamp < end);
    };
    const day = new Date();
    if (!hasActivity(day)) day.setDate(day.getDate() - 1);
    let streak = 0;
    while (streak < 365 && hasActivity(day)) {
      streak++;
      day.setDate(day.getDate() - 1);
    }
    return streak;
  },

  /**
   * P0-1 time-reclaimed stats. Focus = completed session durations inside the
   * window. Resists = BlockedAttempts with action != 'override' (returning to
   * task, including intention breaks AND 'friction_pass' breath-countdown
   * completions — friction_pass is a resist, not an override) inside the
   * window, each credited with a labelled 7-minute estimate. Callers must
   * surface the estimate as such.
   */
  async getTimeReclaimed(days: number): Promise<{
    focusMs: number;
    resistCount: number;
    estimatedMs: number;
    totalMs: number;
  }> {
    const windowStart = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
    const [sessions, attempts] = await Promise.all([
      this.getSessions(),
      this.getBlockedAttempts(),
    ]);
    let focusMs = 0;
    for (const s of sessions) {
      if (s.status === 'completed' && s.startedAt >= windowStart && (s.duration || 0) > 0) {
        focusMs += s.duration as number;
      }
    }
    const resistCount = attempts.filter(
      a => a.timestamp >= windowStart && a.action !== 'override',
    ).length;
    const estimatedMs = resistCount * 7 * 60 * 1000;
    return { focusMs, resistCount, estimatedMs, totalMs: focusMs + estimatedMs };
  },

  /**
   * P1-2 escalating friction. Override wait grows with today's consumption:
   * 0 used -> instant, 1 used -> 30s, 2 used -> 90s. Exhausted (3) is handled
   * by the existing tryConsumeOverride cap; this returns 0 there.
   */
  async getOverrideWaitSeconds(): Promise<number> {
    const used = await this.getOverridesUsedToday();
    if (used <= 0) return 0;
    if (used === 1) return 30;
    if (used === 2) return 90;
    return 0;
  },

  /** Count of resisted attempts ever (action != 'override' — includes 'friction_pass'). */
  async getResistCount(): Promise<number> {
    const attempts = await this.getBlockedAttempts();
    return attempts.filter(a => a.action !== 'override').length;
  },

  /** Total completed focus time ever, in milliseconds. */
  async getTotalFocusMs(): Promise<number> {
    const sessions = await this.getSessions();
    return sessions.reduce(
      (sum, s) => sum + (s.status === 'completed' && (s.duration || 0) > 0 ? (s.duration as number) : 0),
      0,
    );
  },

  // Budgets (per-app opens/minutes limits)
  async getBudgets(): Promise<Budget[]> {
    try {
      const data = await AsyncStorage.getItem(BUDGETS_KEY);
      const parsed = safeParse<Budget[] | null>(data, null);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async getBudgetsForTask(taskId: string): Promise<Budget[]> {
    const all = await this.getBudgets();
    return all.filter(b => b.taskId === taskId);
  },

  /**
   * Task-only enforcement read path: only budgets with a taskId set are
   * enforceable (enabled + limit > 0). Rows without taskId are legacy/inert
   * — stored, never pushed, never enforced (no invisible metering, no data
   * loss, no migration). Push sites must read through this (or
   * getBudgetsForTask for a single active task), never getBudgets().
   */
  async getEnforceableBudgets(): Promise<Budget[]> {
    const all = await this.getBudgets();
    return all.filter(
      b => typeof b.taskId === 'string' && b.taskId.length > 0 && b.enabled === true && b.limit > 0,
    );
  },

  async saveBudget(budget: Budget): Promise<string[]> {
    // limit <= 0 can never trigger — persist as disabled, never drop the row.
    // Collision rule: an enabled budget wins over Feed Shield for the same
    // app (over-limit takes the block path — one app, one enforcement
    // mechanism). Feed entries colliding with the newly enabled budget are
    // auto-disabled here; the disabled package list is returned for UI notice.
    // A task edit could un-block the app tomorrow — the feed row is kept
    // (disabled), never dropped, so re-enabling is one toggle.
    const normalized: Budget =
      budget.limit <= 0 ? { ...budget, enabled: false } : budget;
    await serialized(BUDGETS_KEY, async () => {
      const all = await this.getBudgets();
      const index = all.findIndex(b => b.id === normalized.id);
      if (index >= 0) {
        const prev = all[index];
        // Merge, don't drop: a task-tagged row stays tagged unless the caller
        // explicitly re-tags. Absent stays absent (= legacy/inert — stored,
        // never enforced, no migration that deletes user data).
        all[index] = { ...normalized, taskId: normalized.taskId ?? prev.taskId };
      } else {
        all.push(normalized);
      }
      await AsyncStorage.setItem(BUDGETS_KEY, JSON.stringify(all));
    });
    try {
      return await this.reconcileFeedCollisions();
    } catch {
      return [];
    }
  },

  async deleteBudget(budgetId: string): Promise<void> {
    return serialized(BUDGETS_KEY, async () => {
      const all = await this.getBudgets();
      await AsyncStorage.setItem(
        BUDGETS_KEY,
        JSON.stringify(all.filter(b => b.id !== budgetId)),
      );
    });
  },

  // Blocked domains (browser-level)
  async getBlockedDomains(): Promise<BlockedDomain[]> {
    try {
      const data = await AsyncStorage.getItem(BLOCKED_DOMAINS_KEY);
      const parsed = safeParse<BlockedDomain[] | null>(data, null);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async saveBlockedDomain(entry: BlockedDomain): Promise<void> {
    const domain = entry.domain.trim().toLowerCase();
    // Drop empties/invalid (must contain a dot) — never persist a value the
    // native matcher can't use.
    if (!domain || !domain.includes('.')) return;
    const normalized: BlockedDomain = { ...entry, domain };
    return serialized(BLOCKED_DOMAINS_KEY, async () => {
      const all = await this.getBlockedDomains();
      const index = all.findIndex(d => d.id === normalized.id);
      if (index >= 0) {
        all[index] = normalized;
      } else {
        all.push(normalized);
      }
      await AsyncStorage.setItem(BLOCKED_DOMAINS_KEY, JSON.stringify(all));
    });
  },

  async deleteBlockedDomain(domainId: string): Promise<void> {
    return serialized(BLOCKED_DOMAINS_KEY, async () => {
      const all = await this.getBlockedDomains();
      await AsyncStorage.setItem(
        BLOCKED_DOMAINS_KEY,
        JSON.stringify(all.filter(d => d.id !== domainId)),
      );
    });
  },

  // Feed filters (per-app reels/explore/comments hardening, keyed by package)
  async getFeedFilters(): Promise<FeedFilter[]> {
    try {
      const data = await AsyncStorage.getItem(FEED_FILTERS_KEY);
      const parsed = safeParse<FeedFilter[] | null>(data, null);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async saveFeedFilter(filter: FeedFilter): Promise<{ autoDisabled: boolean; reason: 'blocked' | 'budget' | null }> {
    // Creation-site defaults for missing flags.
    const normalized: FeedFilter = {
      ...filter,
      hideReels: filter.hideReels ?? true,
      hideExplore: filter.hideExplore ?? true,
      hideComments: filter.hideComments ?? false,
      enabled: filter.enabled ?? true,
    };
    // No save-time collision rule: feed filters are global while blocks and
    // budgets are per task, so "blocked by some task" disabled shields that
    // were useful in every other task's session. Precedence is enforced at
    // runtime instead — the service applies Feed Shield only to apps that
    // are not blocked (or over budget) in the running session.
    const result: { autoDisabled: boolean; reason: 'blocked' | 'budget' | null } = {
      autoDisabled: false,
      reason: null,
    };
    return serialized(FEED_FILTERS_KEY, async () => {
      const all = await this.getFeedFilters();
      const index = all.findIndex(f => f.packageName === normalized.packageName);
      if (index >= 0) {
        all[index] = normalized;
      } else {
        all.push(normalized);
      }
      await AsyncStorage.setItem(FEED_FILTERS_KEY, JSON.stringify(all));
      return result;
    });
  },







  /**
   * Retired: feed entries are no longer force-disabled on collision (see
   * saveFeedFilter — runtime precedence handles it per session). Kept as a
   * no-op so saveTask/saveBudget callers need no change. Never throws.
   */
  async reconcileFeedCollisions(): Promise<string[]> {
    return [];
  },

  /**
   * Count of BlockedAttempts with action == 'give_in' since device-local
   * midnight. 'friction_pass' is deliberately EXCLUDED (it is a resist, not
   * a give-in — see widgetMascotMood thresholds). Best-effort: malformed
   * rows are skipped, any read failure yields 0 — never throws.
   */
  async getGiveInsToday(): Promise<number> {
    // Dumfound: frozen at the enable-time snapshot (nothing is logged while
    // on, so the live count would under-report the pre-dumfound mood).
    try {
      const prefs = await this.getPreferences();
      if (prefs.dumfoundMode === true) return Math.max(0, prefs.dumfoundGiveIns ?? 0);
    } catch {
      // Fall through to the live count.
    }
    try {
      const attempts = await this.getBlockedAttempts();
      if (!Array.isArray(attempts)) return 0;
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      let count = 0;
      for (const a of attempts) {
        if (
          a &&
          a.action === 'give_in' &&
          typeof a.timestamp === 'number' &&
          a.timestamp >= todayStart
        ) {
          count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  },

  /**
   * P1-4 milestone share cards. Progress/earned derive from store totals only:
   * focus hours (completed sessions), day streak (existing getStreak rule),
   * resists (action != 'override', so 'friction_pass' counts). No new deps; image cards are a follow-up
   * (needs react-native-view-shot — intentionally NOT installed).
   */
  async getMilestones(): Promise<
    { id: string; label: string; progress: number; target: number; earned: boolean }[]
  > {
    const [focusMs, streak, resists] = await Promise.all([
      this.getTotalFocusMs(),
      this.getStreak(),
      this.getResistCount(),
    ]);
    const focusHours = focusMs / 3_600_000;
    const defs = [
      { id: 'focus-10', label: '10 focus hours', progress: focusHours, target: 10 },
      { id: 'focus-100', label: '100 focus hours', progress: focusHours, target: 100 },
      { id: 'focus-500', label: '500 focus hours', progress: focusHours, target: 500 },
      { id: 'streak-7', label: '7-day streak', progress: streak, target: 7 },
      { id: 'streak-30', label: '30-day streak', progress: streak, target: 30 },
      { id: 'streak-100', label: '100-day streak', progress: streak, target: 100 },
      { id: 'resist-100', label: '100 resists', progress: resists, target: 100 },
      { id: 'resist-1000', label: '1000 resists', progress: resists, target: 1000 },
    ];
    return defs.map(d => ({ ...d, earned: d.progress >= d.target }));
  },
};
