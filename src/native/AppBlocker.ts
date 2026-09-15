import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  parseBlockedDeepLink as parseLink,
  isTasksDeepLink as isTasksLink,
  isPaywallDeepLink as isPaywallLink,
  TASKS_DEEP_LINK,
  PAYWALL_DEEP_LINK,
  type BlockedDeepLink,
} from './blockedContract';

export type { BlockedDeepLink };
export { TASKS_DEEP_LINK, PAYWALL_DEEP_LINK };

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

  async startBlocking(blockedPackages: string[], taskName?: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    try {
      return await AppBlocker.startBlocking(blockedPackages, taskName ?? null);
    } catch {
      // Stale native shell (pre-taskName bridge): the extra arg rejects even
      // with the service on. Retry the legacy arity so blocking still
      // engages instead of showing the re-enable banner by mistake.
      try {
        return await AppBlocker.startBlocking(blockedPackages);
      } catch {
        return false;
      }
    }
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
   * Single-surface rule: the JS interstitial calls this on mount so the
   * native overlay never stacks over it (double blocked screen).
   * Best-effort: resolves false when native is absent; never throws.
   */
  async dismissBlockedOverlay(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.dismissBlockedOverlay) {
      return false;
    }
    try {
      return await AppBlocker.dismissBlockedOverlay();
    } catch {
      return false;
    }
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

  /** P2-2: QS-tile locked state routes here (App.tsx navigates to Paywall). */
  isPaywallDeepLink(url: string): boolean {
    return isPaywallLink(url);
  }

  /**
   * P2-1 widget prefs mirror. Writes {date, todayFocusMin, streak,
   * subscribed, lastPackages, sessionActive, strictActive} to the
   * SharedPreferences file the home-screen widget reads directly (widgets
   * must work with the app dead). Best-effort: resolves false when native
   * is absent; never throws.
   */
  async syncWidgetData(data: {
    todayFocusMin: number;
    streak: number;
    subscribed: boolean;
    lastPackages: string[];
    sessionActive: boolean;
    strictActive: boolean;
  }): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    try {
      return await AppBlocker.syncWidgetData(
        data.todayFocusMin,
        data.streak,
        data.subscribed,
        data.lastPackages,
        data.sessionActive,
        data.strictActive,
      );
    } catch {
      return false;
    }
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
