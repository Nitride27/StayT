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
  action: 'give_in' | 'override';
}

export interface UserPreferences {
  themeMode: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  hapticFeedback: boolean;
  freeTaskLimit: number;
  hasOnboarded: boolean;
  isSubscribed: boolean;
}
