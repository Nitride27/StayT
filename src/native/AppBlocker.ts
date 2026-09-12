import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

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

export interface BlockedDeepLink {
  packageName: string;
  appLabel?: string;
}

/**
 * Exact deep link fired natively by the service-owned block overlay's
 * SWITCH TASK button (StayTAccessibilityService.foregroundTaskPicker).
 * App.tsx routes it to TaskPicker.
 */
export const TASKS_DEEP_LINK = 'exp+stayt-app://tasks';

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
   * Parse an incoming `exp+stayt-app://blocked?packageName=X[&label=Y]` deep link
   * (tapped from the native blocked notification or auto-popup). Validates the
   * scheme FIRST, then the package shape — the intent-filter is exported, so any
   * app can fire it. Returns null for anything malformed.
   */
  parseBlockedDeepLink(url: string): BlockedDeepLink | null {
    if (!url.startsWith('exp+stayt-app://blocked')) return null;
    try {
      const pkg = /[?&]packageName=([^&]+)/.exec(url);
      if (!pkg) return null;
      const packageName = decodeURIComponent(pkg[1]);
      if (
        !/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(packageName) ||
        packageName.length > 256
      ) {
        return null;
      }
      const lbl = /[?&]label=([^&]+)/.exec(url);
      let appLabel: string | undefined;
      try {
        appLabel = lbl ? decodeURIComponent(lbl[1]).slice(0, 128) : undefined;
      } catch {
        appLabel = undefined;
      }
      return appLabel ? { packageName, appLabel } : { packageName };
    } catch {
      return null;
    }
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
   * Match the overlay's SWITCH TASK deep link (`exp+stayt-app://tasks`,
   * optionally with query params). Returns true only for the exact tasks
   * path — same strict-scheme-first validation as parseBlockedDeepLink.
   */
  isTasksDeepLink(url: string): boolean {
    return url === TASKS_DEEP_LINK || url.startsWith('exp+stayt-app://tasks?');
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
