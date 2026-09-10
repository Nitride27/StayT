export interface Task {
  id: string;
  name: string;
  packageName: string;
  appName: string;
  createdAt: number;
  lastUsed: number;
  useCount: number;
  isActive: boolean;
  streak: number;
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
