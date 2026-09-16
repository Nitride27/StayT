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
}

/** Effective block list for a task: paid multi-list, else the single app. */
export function blockedPackagesOf(task: Task): string[] {
  return task.blockedPackages && task.blockedPackages.length > 0
    ? task.blockedPackages
    : [task.packageName];
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
