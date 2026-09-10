import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const { AppBlocker } = NativeModules;

export interface BlockedAttemptEvent {
  packageName: string;
  timestamp: number;
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

  async getInstalledApps(): Promise<{ packageName: string; appName: string }[]> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return [];
    }
    return AppBlocker.getInstalledApps();
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
