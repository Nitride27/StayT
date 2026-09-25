export interface Task {
  id: string;
  name: string;
  packageName: string;
  appName: string;
  /** Extra blocked apps (paid). Defaults to [packageName] when absent. */
  blockedPackages?: string[];
  /** True for first-launch seeds; presets never count toward the free task limit. */
  isPreset?: boolean;
  createdAt: number;
  lastUsed: number;
  useCount: number;
  isActive: boolean;
  streak: number;
  /** Hardcore strict mode (Pro): no override or break escape on the interstitial. */
  strict?: boolean;
  /**
   * Dumbphone Mode (per-task): strict blocking, nothing counts. While on,
   * task setup greys out every other section and the interstitial + give_in
   * gate treat the task as strict-but-non-consequential (no logging, no
   * override consume). Source of truth — prefs.dumfoundMode is deprecated.
   */
  dumbphoneMode?: boolean;
  /**
   * Allowlist mode: when true, ONLY packages in `allowlist` stay usable and
   * everything else is blocked (native handles the inversion). When false or
   * absent, `blockedPackagesOf(task)` is the blocklist. An empty allowlist is
   * distinct from absent — pass through faithfully, never coerce to null.
   */
  allowlistMode?: boolean;
  /** Packages usable while `allowlistMode` is on. */
  allowlist?: string[];
}

/**
 * Product-clarity model — three things users confuse, three scopes:
 * - Preset = a seed Task (isPreset) with a blocklist. One tap starts a
 *   session that blocks those apps NOW. Presets never count toward the free
 *   task limit; they are still just tasks.
 * - Schedule = a recurring auto-block window (FocusSchedule) attached to ONE
 *   task. Fired natively (AlarmManager); needs no session. Pro.
 * - Budget = a per-app meter (opens/minutes) scoped to ONE task via taskId.
 *   taskId is optional in the type for legacy rows only — REQUIRED by
 *   convention for all new rows. Rows without taskId are legacy/inert
 *   (stored, never pushed, never enforced). Enforcement is task-scoped:
 *   native receives only tagged budgets via setBudgets on its own path,
 *   never via startBlocking. limit <= 0 = disabled.
 *
 * Recurring auto-block window for a task (Pro). Times are minutes since
 * midnight local; days use JS getDay() convention (0 = Sunday).
 */
export interface FocusSchedule {
  id: string;
  taskId: string;
  days: number[];
  startMinutes: number;
  endMinutes: number;
  enabled: boolean;
  /**
   * One-time window (epoch ms). When both are set the schedule fires once,
   * [onceStart, onceEnd), and `days` is ignored (Focus sprint). Absent =
   * recurring weekly on `days`, as before.
   */
  onceStart?: number;
  onceEnd?: number;
}

/** Effective block list for a task: paid multi-list, else the single app. */
export function blockedPackagesOf(task: Task): string[] {
  return task.blockedPackages && task.blockedPackages.length > 0
    ? task.blockedPackages
    : [task.packageName];
}

/**
 * Single source for strict gating: Task.strict OR Dumfound on.
 * Dumfound forces the strict UI (no override/break escapes) while staying
 * non-consequential (no give_in log, no override consume — gated separately).
 */
export function isEffectiveStrict(taskStrict?: boolean, dumfoundMode?: boolean): boolean {
  return taskStrict === true || dumfoundMode === true;
}

export interface Session {
  id: string;
  taskId: string;
  startedAt: number;
  endedAt: number | null;
  duration: number | null;
  status: 'active' | 'completed' | 'cancelled';
}

export interface BlockedAttempt {
  id: string;
  packageName: string;
  taskId: string;
  timestamp: number;
  /**
   * 'give_in' = entry log for a block (App.tsx) / returned to task;
   * 'friction_pass' = waited out the native breath countdown, then returned
   *   to task (feature 1 — counts as a RESIST, never as a give-in);
   * 'override'/'break' = consumed one override unit (replace the entry
   *   give_in via deleteLatestGiveIn, so each block yields one record).
   */
  action: 'give_in' | 'override' | 'break' | 'friction_pass';
  /** Intention-break text (action 'break' only). */
  intention?: string;
  /** Intention-break length in minutes (action 'break' only). */
  breakMinutes?: number;
}

export interface UserPreferences {
  themeMode: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  hapticFeedback: boolean;
  freeTaskLimit: number;
  hasOnboarded: boolean;
  isSubscribed: boolean;
  /** True once the OEM battery-optimization onboarding warning was shown. */
  oemOnboardingDone?: boolean;
  /** Escalating-friction toggle for session starts. Absent = disabled. */
  frictionEnabled?: boolean;
  /** Friction delay in seconds. Absent = 10. */
  frictionDelaySeconds?: number;
  /**
   * Dumfound mode: blocks stay enforced but non-consequential — no give_in
   * logging, no override-budget consume, streak + give-ins frozen at the
   * enable-time snapshots below (store.getStreak/getGiveInsToday return the
   * snapshots while this is on, so widget/mascot never move). The 30s native
   * breath countdown still runs; it only delays entry, never records.
   * Absent = off.
   */
  dumfoundMode?: boolean;
  /** Streak display frozen while dumfoundMode is on (snapshot at enable). */
  dumfoundStreak?: number;
  /** Give-ins-today display frozen while dumfoundMode is on (snapshot at enable). */
  dumfoundGiveIns?: number;
}

/**
 * Per-app usage budget. `kind` selects the meter ('opens' counts launches,
 * 'minutes' counts foreground time). A budget with `limit <= 0` is treated
 * as disabled wherever it is consumed (store normalizes `enabled` to false
 * on save; the bridge coerces before pushing native).
 */
export interface Budget {
  id: string;
  packageName: string;
  appLabel: string;
  kind: 'opens' | 'minutes';
  limit: number;
  enabled: boolean;
  /**
   * Task scope — REQUIRED by convention for all new rows. Rows without
   * taskId are legacy/inert: kept in storage (no data loss, no migration)
   * but never pushed to native and never enforced. Task UI reads via
   * store.getBudgetsForTask(taskId); enforcement reads tagged rows only
   * (see store.getEnforceableBudgets).
   */
  taskId?: string;
}

/** Domain blocked at the browser level. `domain` is stored lowercased/trimmed. */
export interface BlockedDomain {
  id: string;
  domain: string;
  enabled: boolean;
}

/**
 * Per-app feed hardening flags. Creation-site defaults: hideReels true,
 * hideExplore true, hideComments false, enabled true (applied in
 * store.saveFeedFilter / bridge.setFeedFilters for missing fields).
 */
export interface FeedFilter {
  packageName: string;
  hideReels: boolean;
  hideExplore: boolean;
  hideComments: boolean;
  enabled: boolean;
}
