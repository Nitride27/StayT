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
  packageName: string;
  timestamp: number;
}

export interface UserPreferences {
  themeMode: 'light' | 'dark' | 'system';
  notificationsEnabled: boolean;
  hapticFeedback: boolean;
  freeTaskLimit: number;
  hasOnboarded: boolean;
  isSubscribed: boolean;
}
