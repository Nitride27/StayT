import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  parseBlockedDeepLink as parseLink,
  isTasksDeepLink as isTasksLink,
  TASKS_DEEP_LINK,
  type BlockedDeepLink,
} from './blockedContract';

export type { BlockedDeepLink };
export { TASKS_DEEP_LINK };

const { AppBlocker } = NativeModules;

export interface BlockedAttemptEvent {
  packageName: string;
  timestamp: number;
  appLabel?: string;
}

export interface InstalledApp {
  packageName: string;
  appName: string;
  iconBase64?: string;
}

/** Schedule payload mirrored by the native AlarmManager programmer. */
export interface NativeSchedule {
  days: number[];
  startMinutes: number;
  endMinutes: number;
  enabled: boolean;
  blockedPackages: string[];
}

export interface BlockedDeepLinkCompat {
  packageName: string;
}

class AppBlockerBridge {
  private eventEmitter: NativeEventEmitter | null = null;

  constructor() {
    if (Platform.OS === 'android' && AppBlocker) {
      this.eventEmitter = new NativeEventEmitter(AppBlocker);
    }
  }

  async isAccessibilityServiceEnabled(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.isAccessibilityServiceEnabled();
  }

  openAccessibilitySettings(): void {
    if (Platform.OS === 'android' && AppBlocker) {
      AppBlocker.openAccessibilitySettings();
    }
  }

  async startBlocking(blockedPackages: string[]): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.startBlocking(blockedPackages);
  }

  async stopBlocking(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.stopBlocking();
  }

  async pauseBlocking(seconds: number): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.pauseBlocking(seconds);
  }

  /**
   * Program native alarms for focus schedules. The native side (re)computes
   * the next start/stop firings and mirrors the pushed list for boot restore
   * (source of truth stays the store — re-push after every schedule edit).
   */
  async setSchedules(schedules: NativeSchedule[]): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.setSchedules(schedules);
  }

  async getInstalledApps(): Promise<InstalledApp[]> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return [];
    }
    return AppBlocker.getInstalledApps();
  }

  /**
   * Thin adapter over the BlockedContract seam (src/native/blockedContract.ts).
   * All URI shape/regex/length rules live there; this only delegates.
   */
  parseBlockedDeepLink(url: string): BlockedDeepLink | null {
    return parseLink(url);
  }

  async requestNotificationPermission(): Promise<boolean> {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  }

  async isNotificationPermissionGranted(): Promise<boolean> {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  }

  /**
   * Thin adapter over the BlockedContract seam — see blockedContract.ts.
   */
  isTasksDeepLink(url: string): boolean {
    return isTasksLink(url);
  }

  onBlockedAttempt(callback: (event: BlockedAttemptEvent) => void): () => void {
    if (!this.eventEmitter) {
      return () => {};
    }

    const subscription = this.eventEmitter.addListener(
      'onBlockedAttempt',
      callback
    );

    return () => subscription.remove();
  }
}

export default new AppBlockerBridge();
