import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task, Session, UserPreferences } from '../types';

const TASKS_KEY = '@stayt_tasks';
const SESSIONS_KEY = '@stayt_sessions';
const PREFERENCES_KEY = '@stayt_preferences';

export const store = {
  // Tasks
  async getTasks(): Promise<Task[]> {
    const data = await AsyncStorage.getItem(TASKS_KEY);
    return data ? JSON.parse(data) : [];
  },

  async saveTask(task: Task): Promise<void> {
    const tasks = await this.getTasks();
    const index = tasks.findIndex(t => t.id === task.id);
    if (index >= 0) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  },

  async deleteTask(taskId: string): Promise<void> {
    const tasks = await this.getTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    await AsyncStorage.setItem(TASKS_KEY, JSON.stringify(filtered));
  },

  // Sessions
  async getSessions(): Promise<Session[]> {
    const data = await AsyncStorage.getItem(SESSIONS_KEY);
    return data ? JSON.parse(data) : [];
  },

  async saveSession(session: Session): Promise<void> {
    const sessions = await this.getSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  },

  async getActiveSession(): Promise<Session | null> {
    const sessions = await this.getSessions();
    return sessions.find(s => s.status === 'active') || null;
  },

  // Preferences
  async getPreferences(): Promise<UserPreferences> {
    const data = await AsyncStorage.getItem(PREFERENCES_KEY);
    return data ? JSON.parse(data) : {
      darkMode: false,
      notificationsEnabled: true,
      hapticFeedback: true,
      freeTaskLimit: 1,
    };
  },

  async savePreferences(prefs: UserPreferences): Promise<void> {
    await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
  },

  // Streak calculation
  async calculateStreak(taskId: string): Promise<number> {
    const sessions = await this.getSessions();
    const taskSessions = sessions
      .filter(s => s.taskId === taskId && s.status === 'completed')
      .sort((a, b) => b.endedAt! - a.endedAt!);

    if (taskSessions.length === 0) return 0;

    let streak = 1;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    for (let i = 0; i < taskSessions.length; i++) {
      const sessionDate = new Date(taskSessions[i].endedAt!);
      const sessionDay = new Date(sessionDate.getFullYear(), sessionDate.getMonth(), sessionDate.getDate()).getTime();
      
      if (i === 0) {
        if (sessionDay !== today) return 0;
        continue;
      }

      const prevSessionDate = new Date(taskSessions[i - 1].endedAt!);
      const prevSessionDay = new Date(prevSessionDate.getFullYear(), prevSessionDate.getMonth(), prevSessionDate.getDate()).getTime();
      
      const daysDiff = (prevSessionDay - sessionDay) / (1000 * 60 * 60 * 24);
      if (daysDiff === 1) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  },
};
