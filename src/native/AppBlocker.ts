import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Budget, FeedFilter } from '../types';
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
    try {
      return await AppBlocker.isAccessibilityServiceEnabled();
    } catch {
      return false;
    }
  }

  openAccessibilitySettings(): void {
    if (Platform.OS === 'android' && AppBlocker) {
      AppBlocker.openAccessibilitySettings();
    }
  }

  /**
   * `opts.allowlist`: null/undefined = blocklist mode (default, old callers);
   * a concrete array (including []) is passed through faithfully as the 3rd
   * native arg — null vs [] is semantically distinct natively, so [] is
   * never coerced to null here.
   */
  async startBlocking(blockedPackages: string[], taskName?: string, opts?: { allowlist?: string[] | null }): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    const allowlist = opts?.allowlist ?? null;
    try {
      return await AppBlocker.startBlocking(blockedPackages, taskName ?? null, allowlist);
    } catch {
      // Stale native shell (pre-allowlist bridge): the extra arg rejects even
      // with the service on. Retry the taskName arity, then the legacy arity,
      // so blocking still engages instead of showing the re-enable banner.
      try {
        return await AppBlocker.startBlocking(blockedPackages, taskName ?? null);
      } catch {
        try {
          return await AppBlocker.startBlocking(blockedPackages);
        } catch {
          return false;
        }
      }
    }
  }

  async stopBlocking(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    try {
      return await AppBlocker.stopBlocking();
    } catch {
      return false;
    }
  }

  async pauseBlocking(seconds: number): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return false;
    }
    try {
      return await AppBlocker.pauseBlocking(seconds);
    } catch {
      return false;
    }
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
    try {
      return await AppBlocker.setSchedules(schedules);
    } catch {
      return false;
    }
  }

  async getInstalledApps(): Promise<InstalledApp[]> {
    if (Platform.OS !== 'android' || !AppBlocker) {
      return [];
    }
    try {
      return await AppBlocker.getInstalledApps();
    } catch {
      return [];
    }
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
   * subscribed, lastPackages, sessionActive, strictActive, giveInsToday,
   * mascotMood} to the SharedPreferences file the home-screen widget reads
   * directly (widgets must work with the app dead). Best-effort: resolves
   * false when native is absent; never throws.
   * `mascotMood` ('bright'|'steady'|'wilted', '' = keep previous) always
   * rides along. Native exposes a single 9-arg method (TurboModules reject
   * duplicate JS names, so there is no 8-arg shell to fall back to).
   */
  async syncWidgetData(data: {
    todayFocusMin: number;
    streak: number;
    subscribed: boolean;
    lastPackages: string[];
    sessionActive: boolean;
    strictActive: boolean;
    activeTaskName: string | null;
    giveInsToday: number;
    mascotMood?: string;
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
        data.activeTaskName,
        data.giveInsToday ?? 0,
        data.mascotMood ?? '',
      );
    } catch {
      return false;
    }
  }

  /**
   * Push per-app usage budgets. limit <= 0 is coerced to disabled before
   * crossing the bridge. Best-effort: resolves false when native is absent
   * or rejects; never throws.
   */
  async setBudgets(budgets: Budget[]): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.setBudgets) {
      return false;
    }
    try {
      const list = Array.isArray(budgets) ? budgets : [];
      return await AppBlocker.setBudgets(
        list.map(b => ({ ...b, enabled: b.enabled === true && b.limit > 0 })),
      );
    } catch {
      return false;
    }
  }

  /**
   * Read back native usage counters keyed by package name. Best-effort:
   * resolves {} when native is absent, rejects, or returns garbage; never
   * throws.
   */
  async getBudgetUsage(): Promise<Record<string, { opens: number; minutes: number }>> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.getBudgetUsage) {
      return {};
    }
    try {
      const raw = await AppBlocker.getBudgetUsage();
      if (!raw || typeof raw !== 'object') return {};
      return raw as Record<string, { opens: number; minutes: number }>;
    } catch {
      return {};
    }
  }

  /**
   * Push escalating-friction config. Best-effort: resolves false when native
   * is absent or rejects; never throws.
   */
  async setFriction(f: { enabled: boolean; delaySeconds: number; escalate: boolean }): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.setFriction) {
      return false;
    }
    try {
      return await AppBlocker.setFriction({
        enabled: f.enabled === true,
        delaySeconds: Math.max(0, f.delaySeconds || 0),
        escalate: f.escalate === true,
      });
    } catch {
      return false;
    }
  }

  /**
   * Push browser-level blocked domains. Entries are lowercased/trimmed and
   * empties/invalid (no dot) are dropped before crossing the bridge.
   * Best-effort: resolves false when native is absent or rejects; never
   * throws.
   */
  async setBlockedDomains(domains: string[]): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.setBlockedDomains) {
      return false;
    }
    try {
      const list = (Array.isArray(domains) ? domains : [])
        .map(d => (typeof d === 'string' ? d.trim().toLowerCase() : ''))
        .filter(d => d.length > 0 && d.includes('.'));
      return await AppBlocker.setBlockedDomains(list);
    } catch {
      return false;
    }
  }

  /**
   * Push per-app feed-hardening flags. Missing flags fall back to the
   * creation-site defaults (hideReels true, hideExplore true, hideComments
   * false, enabled true). Best-effort: resolves false when native is absent
   * or rejects; never throws.
   */
  async setFeedFilters(filters: FeedFilter[]): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.setFeedFilters) {
      return false;
    }
    try {
      const list = (Array.isArray(filters) ? filters : []).map(ff => ({
        ...ff,
        hideReels: ff.hideReels ?? true,
        hideExplore: ff.hideExplore ?? true,
        hideComments: ff.hideComments ?? false,
        enabled: ff.enabled ?? true,
      }));
      return await AppBlocker.setFeedFilters(list);
    } catch {
      return false;
    }
  }

  /**
   * Open the manufacturer battery-optimization settings screen (OEM
   * onboarding). Best-effort: resolves false when native is absent or
   * rejects; never throws.
   */
  async openManufacturerSettings(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.openManufacturerSettings) {
      return false;
    }
    try {
      return await AppBlocker.openManufacturerSettings();
    } catch {
      return false;
    }
  }

  /**
   * Open the battery optimization screen for StayT (request-ignore with
   * package URI, then the list, then generic Settings natively).
   * Best-effort: resolves false when native is absent or rejects; never throws.
   */
  async openBatteryOptimizationSettings(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.openBatteryOptimizationSettings) {
      return false;
    }
    try {
      return await AppBlocker.openBatteryOptimizationSettings();
    } catch {
      return false;
    }
  }

  /**
   * Open the StayT app info screen (Settings > Apps > StayT path).
   * Best-effort: resolves false when native is absent or rejects; never throws.
   */
  async openAppInfoSettings(): Promise<boolean> {
    if (Platform.OS !== 'android' || !AppBlocker || !AppBlocker.openAppInfoSettings) {
      return false;
    }
    try {
      return await AppBlocker.openAppInfoSettings();
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
