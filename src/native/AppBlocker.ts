import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

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

  async startBlocking(allowedPackages: string[]): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.startBlocking(allowedPackages);
  }

  async stopBlocking(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    return AppBlocker.stopBlocking();
  }

  async getInstalledApps(): Promise<{ packageName: string; appName: string }[]> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return [];
    }
    return AppBlocker.getInstalledApps();
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
