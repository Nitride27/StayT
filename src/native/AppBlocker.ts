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

export interface BlockedDeepLink {
  packageName: string;
  appLabel?: string;
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
