import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, Alert, TouchableOpacity, TouchableWithoutFeedback, StyleSheet, ScrollView, TextInput, FlatList, Modal, Keyboard } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task, FocusSchedule, Budget, BlockedDomain, FeedFilter, blockedPackagesOf } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { TaskGlyph, CheckIcon, ChevronLeftIcon } from '../components/icons';
import AppBlocker from '../native/AppBlocker';
import { syncWidgetNow } from '../widget/widgetSync';
import { tap } from '../haptics';

type InstalledApp = { packageName: string; appName: string; iconBase64?: string };

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskSetup'>;
  route: { params: { task?: Task } };
};

// Module-level cache: the bridge payload is ~1MB of base64 icons and every
// row decodes its PNG on mount — without this, each visit to New/Edit Task
// re-fetches + re-decodes the whole launcher list and janks.
let installedAppsCache: InstalledApp[] | null = null;

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// Mon-first chip order; days use JS getDay() convention (0 = Sunday).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MINUTE_STEPS = [0, 15, 30, 45];

function formatScheduleTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Re-push the store's schedules to native after every schedule edit.
// Source of truth stays in the store; native persists nothing.
async function syncSchedulesToNative(): Promise<void> {
  try {
    const [schedules, tasks] = await Promise.all([store.getSchedules(), store.getTasks()]);
    const byId = new Map(tasks.map(t => [t.id, t] as const));
    const payload = schedules
      .filter(s => byId.has(s.taskId))
      .map(s => ({
        days: s.days,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        enabled: s.enabled,
        blockedPackages: blockedPackagesOf(byId.get(s.taskId)!),
      }));
    await AppBlocker.setSchedules(payload).catch(() => {});
  } catch {
    // Best-effort; a failed push must never block the save flow.
  }
}

// Wave 2C1 mirrors of syncSchedulesToNative: the store is the source of
// truth, native persists nothing. Every push is best-effort.
async function syncBudgetsToNative(): Promise<void> {
  try {
    const all = await store.getBudgets();
    await AppBlocker.setBudgets(all.filter(b => b.enabled)).catch(() => {});
  } catch {
    // Best-effort; a failed push must never block the UI flow.
  }
}

async function syncDomainsToNative(): Promise<void> {
  try {
    const all = await store.getBlockedDomains();
    await AppBlocker.setBlockedDomains(all.filter(d => d.enabled).map(d => d.domain)).catch(() => {});
  } catch {
    // Best-effort; a failed push must never block the UI flow.
  }
}

async function syncFeedsToNative(): Promise<void> {
  try {
    const all = await store.getFeedFilters();
    await AppBlocker.setFeedFilters(all).catch(() => {});
  } catch {
    // Best-effort; a failed push must never block the UI flow.
  }
}

// Small on/off switch reusing the schedule toggle chrome, for the additive
// Wave 2C1 rows. Existing toggles above are untouched.
function RowSwitch(props: { on: boolean; onPress: () => void; border: string; label: string }) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={props.onPress}
      style={[styles.toggleTrack, { borderColor: props.border }, props.on && styles.toggleTrackOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: props.on }}
      accessibilityLabel={props.label}
    >
      <View style={[styles.toggleKnob, props.on && styles.toggleKnobOn]} />
    </TouchableOpacity>
  );
}

// Shared installed-app picker modal for the Wave 2C1 allowlist + feed cards.
// The main task app picker above is untouched; this is the additive twin.
function AppSelectModal(props: {
  visible: boolean;
  onClose: () => void;
  onPick: (app: InstalledApp) => void;
  apps: InstalledApp[];
  picked: string[];
  cardBg: string;
  border: string;
  ink: string;
  muted: string;
  placeholder: string;
}) {
  const [q, setQ] = useState('');
  const filtered = props.apps.filter(
    a =>
      a.appName.toLowerCase().includes(q.toLowerCase()) ||
      a.packageName.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <TouchableWithoutFeedback onPress={() => { props.onClose(); Keyboard.dismiss(); }}>
        <View style={styles.pickerBackdrop}>
          <TouchableWithoutFeedback>
            <View style={[styles.pickerCard, { backgroundColor: props.cardBg, borderColor: props.border }]}>
              <TextInput
                style={[styles.input, { color: props.ink, borderColor: props.border, marginBottom: spacing.sm }]}
                placeholder={props.placeholder}
                placeholderTextColor={props.muted}
                value={q}
                onChangeText={setQ}
                autoFocus
              />
              <FlatList
                data={filtered}
                keyExtractor={app => app.packageName}
                initialNumToRender={20}
                maxToRenderPerBatch={20}
                windowSize={7}
                removeClippedSubviews
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={[typography.caption, { color: props.muted, textAlign: 'center', paddingVertical: spacing.md }]}>
                    No apps found
                  </Text>
                }
                renderItem={({ item: app }) => {
                  const checked = props.picked.includes(app.packageName);
                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => props.onPick(app)}
                      style={[
                        styles.appRow,
                        {
                          backgroundColor: checked ? 'rgba(88,204,2,0.10)' : 'transparent',
                          borderRadius: radius.sm,
                        },
                      ]}
                    >
                      <View style={[styles.checkbox, { borderColor: props.border }, checked && styles.checkboxChecked]}>
                        {checked && (
                          <CheckIcon size={14} color={colors.midnight} />
                        )}
                      </View>
                      {app.iconBase64 ? (
                        <Image
                          source={{ uri: `data:image/png;base64,${app.iconBase64}` }}
                          style={styles.appIcon}
                        />
                      ) : (
                        <View style={styles.appIconFallback}>
                          <TaskGlyph name={app.appName} size={18} color={colors.midnight} />
                        </View>
                      )}
                      <View style={styles.appInfo}>
                        <Text style={[typography.bodyMedium, { color: props.ink }]} numberOfLines={1}>
                          {app.appName}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

export default function TaskSetupScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const existingTask = route.params?.task;
  const [taskName, setTaskName] = useState(existingTask?.name || '');
  const [packageName, setPackageName] = useState(existingTask?.packageName || '');
  const [appName, setAppName] = useState(existingTask?.appName || '');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [selectedApps, setSelectedApps] = useState<InstalledApp[]>(() => {
    if (!existingTask) return [];
    if (existingTask.blockedPackages && existingTask.blockedPackages.length > 0) {
      return existingTask.blockedPackages.map(pkg => ({
        packageName: pkg,
        appName: pkg === existingTask.packageName ? existingTask.appName : pkg,
      }));
    }
    return existingTask.packageName
      ? [{ packageName: existingTask.packageName, appName: existingTask.appName }]
      : [];
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startMinutes, setStartMinutes] = useState(9 * 60);
  const [endMinutes, setEndMinutes] = useState(17 * 60);
  const [existingScheduleId, setExistingScheduleId] = useState<string | null>(null);
  // P1-1 hardcore strict mode (Pro): no override or break escape.
  const [strict, setStrict] = useState(existingTask?.strict === true);
  // ── Wave 2C1 A: schedule presets (free) ──
  const [scheduleFromPreset, setScheduleFromPreset] = useState(false);
  const [presetNote, setPresetNote] = useState<string | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  // ── Wave 2C1 C: dumbphone allowlist (Pro flagship, per-task) ──
  const [allowlistMode, setAllowlistMode] = useState(existingTask?.allowlistMode === true);
  const [allowlistPkgs, setAllowlistPkgs] = useState<string[]>(existingTask?.allowlist ?? []);
  const [allowlistPickerOpen, setAllowlistPickerOpen] = useState(false);
  // ── Wave 2C1 B/D/E: global lists (budgets, domains, feed filters) ──
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetUsage, setBudgetUsage] = useState<Record<string, { opens: number; minutes: number }>>({});
  const [newBudgetPkg, setNewBudgetPkg] = useState('');
  const [newBudgetKind, setNewBudgetKind] = useState<'opens' | 'minutes'>('opens');
  const [newBudgetLimit, setNewBudgetLimit] = useState(10);
  const [domains, setDomains] = useState<BlockedDomain[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [domainError, setDomainError] = useState<string | null>(null);
  const [feedFilters, setFeedFilters] = useState<FeedFilter[]>([]);
  const [feedPickerOpen, setFeedPickerOpen] = useState(false);

  // Wave 2C1 lists live outside the task — (re)load on mount and on focus.
  const refreshWave2Lists = useCallback(() => {
    store.getBudgets().then(setBudgets).catch(() => {});
    store.getBlockedDomains().then(setDomains).catch(() => {});
    store.getFeedFilters().then(setFeedFilters).catch(() => {});
    AppBlocker.getBudgetUsage().then(u => setBudgetUsage(u ?? {})).catch(() => {});
  }, []);

  useEffect(() => { refreshWave2Lists(); }, [refreshWave2Lists]);

  useEffect(() => {
    let live = true;
    // Cache-first: returning to this screen must not re-decode the whole
    // launcher list. The silent refresh below keeps it fresh for newly
    // installed apps without blocking the paint.
    if (installedAppsCache) setInstalledApps(installedAppsCache);
    AppBlocker.getInstalledApps()
      .then(apps => {
        installedAppsCache = apps;
        if (live) setInstalledApps(apps);
      })
      .catch(() => { if (live && !installedAppsCache) setInstalledApps([]); });
    store.getPreferences()
      .then(p => { if (live) setIsSubscribed(p.isSubscribed === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!existingTask) return;
    let live = true;
    store.getSchedulesForTask(existingTask.id)
      .then(list => {
        if (!live || list.length === 0) return;
        const s: FocusSchedule = list[0];
        setExistingScheduleId(s.id);
        setScheduleEnabled(s.enabled);
        setScheduleDays(s.days);
        setStartMinutes(s.startMinutes);
        setEndMinutes(s.endMinutes);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [existingTask?.id]);

  // Re-read subscription on focus: the user may flip Pro in Settings or
  // Paywall and return here with a stale mount-time value.
  useFocusEffect(
    useCallback(() => {
      store.getPreferences()
        .then(p => setIsSubscribed(p.isSubscribed === true))
        .catch(() => {});
      refreshWave2Lists();
    }, [refreshWave2Lists]),
  );

  const filteredApps = installedApps.filter(
    (a) =>
      a.appName.toLowerCase().includes(appSearchQuery.toLowerCase()) ||
      a.packageName.toLowerCase().includes(appSearchQuery.toLowerCase()),
  );
  // Collapsed until tapped: the picker lives in a Modal so tapping anywhere
  // outside it dismisses it. The list itself lazy-renders via FlatList.
  const [appPickerOpen, setAppPickerOpen] = useState(false);

  const handlePickApp = (app: InstalledApp) => {
    if (isSubscribed === null) return;
    tap();
    const already = selectedApps.some(a => a.packageName === app.packageName);
    if (already) {
      const next = selectedApps.filter(a => a.packageName !== app.packageName);
      setSelectedApps(next);
      setPackageName(next[0]?.packageName ?? '');
      setAppName(next[0]?.appName ?? '');
      return;
    }
    // Free tier covers ONE app at a time: tapping another app asks whether to
    // replace it (keeps upsell discovery) instead of silently swapping.
    if (!isSubscribed && selectedApps.length >= 1) {
      Alert.alert(`Block "${app.appName}" instead?`, 'Free: 1 app. Replace it or go Pro.', [
        {
          text: 'Replace',
          onPress: () => {
            setSelectedApps([app]);
            setPackageName(app.packageName);
            setAppName(app.appName);
            setAppSearchQuery('');
          },
        },
        { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    const next = [...selectedApps, app];
    setSelectedApps(next);
    setPackageName(next[0].packageName);
    setAppName(next[0].appName);
    setAppSearchQuery('');
  };

  const isPro = isSubscribed === true;

  const showScheduleProGate = () => {
    Alert.alert('Pro feature', 'Schedules are Pro.', [
      { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // P1-1: strict mode reuses the same Pro-gate pattern as schedules.
  const handleToggleStrict = () => {
    if (!isPro) {
      Alert.alert('Pro feature', 'Strict mode is Pro.', [
        { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    tap();
    setStrict(v => !v);
  };

  const handleToggleSchedule = () => {
    if (!isPro) {
      // Free undo: a preset just turned the schedule on — switching it back
      // off is not a Pro edit. Turning it on or editing stays gated.
      if (scheduleEnabled && scheduleFromPreset) {
        tap();
        setScheduleEnabled(false);
        setScheduleFromPreset(false);
        return;
      }
      showScheduleProGate();
      return;
    }
    tap();
    setScheduleEnabled(v => !v);
  };

  const handleToggleDay = (day: number) => {
    if (!isPro) { showScheduleProGate(); return; }
    tap();
    setScheduleDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const adjustHour = (which: 'start' | 'end', delta: number) => {
    if (!isPro) { showScheduleProGate(); return; }
    tap();
    if (which === 'start') {
      setStartMinutes(prev => {
        const h = Math.floor(prev / 60);
        return ((h + delta + 24) % 24) * 60 + (prev % 60);
      });
    } else {
      setEndMinutes(prev => {
        const h = Math.floor(prev / 60);
        return ((h + delta + 24) % 24) * 60 + (prev % 60);
      });
    }
  };

  const cycleMinute = (which: 'start' | 'end') => {
    if (!isPro) { showScheduleProGate(); return; }
    tap();
    if (which === 'start') {
      setStartMinutes(prev => {
        const h = Math.floor(prev / 60);
        const idx = MINUTE_STEPS.indexOf(prev % 60);
        return h * 60 + MINUTE_STEPS[(idx + 1) % MINUTE_STEPS.length];
      });
    } else {
      setEndMinutes(prev => {
        const h = Math.floor(prev / 60);
        const idx = MINUTE_STEPS.indexOf(prev % 60);
        return h * 60 + MINUTE_STEPS[(idx + 1) % MINUTE_STEPS.length];
      });
    }
  };

  // ── Wave 2C1: Pro upsell helper (mirrors the strict/schedule gate copy) ──
  const showWave2ProGate = (feature: string, blurb: string) => {
    Alert.alert('Pro feature', `${feature} ${blurb}`, [
      { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ── Wave 2C1 A: schedule presets (FREE — bypass the Pro gate) ──
  const applySchedulePreset = (kind: 'bedtime' | 'work') => {
    if (presetBusy) return;
    tap();
    if (kind === 'bedtime') {
      setScheduleDays([0, 1, 2, 3, 4, 5, 6]);
      setStartMinutes(1380);
      setEndMinutes(420);
      setPresetNote('Bedtime on.');
    } else {
      setScheduleDays([1, 2, 3, 4, 5]);
      setStartMinutes(540);
      setEndMinutes(1020);
      setPresetNote('Work hours on.');
    }
    setScheduleEnabled(true);
    setScheduleFromPreset(true);
  };

  // One-shot 25-min block, today only. Re-tapping yields the same window, so
  // it is idempotent — that plus presetBusy is the double-tap safety.
  // Overlap with an existing schedule is allowed (native handles overlap).
  const applySprintPreset = () => {
    if (presetBusy) return;
    setPresetBusy(true);
    tap();
    const now = new Date();
    const start = now.getHours() * 60 + now.getMinutes();
    let end = start + 25;
    let clamped = false;
    if (end >= 1440) { end = 1439; clamped = true; }
    setScheduleDays([now.getDay()]);
    setStartMinutes(start);
    setEndMinutes(end);
    setScheduleEnabled(true);
    setScheduleFromPreset(true);
    setPresetNote(
      `Today ${formatScheduleTime(start)}–${formatScheduleTime(end)}${clamped ? ' (to midnight)' : ''}`,
    );
    setPresetBusy(false);
  };

  // ── Wave 2C1 B: daily budgets (free: 1 budgeted app) ──
  const showBudgetProGate = () => {
    Alert.alert('One budget on Free', 'Free: 1 app. Pro: unlimited.', [
      { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleAddBudget = async () => {
    tap();
    const pkg = newBudgetPkg.trim();
    if (!pkg) {
      Alert.alert('Pick an app', 'Choose an app below.');
      return;
    }
    if (!isPro && budgets.length >= 1) { showBudgetProGate(); return; }
    const limit = Math.min(999, Math.max(1, newBudgetLimit));
    const duplicate = budgets.some(b => b.packageName === pkg && b.kind === newBudgetKind);
    // Label is derived — one less field in the form.
    const label =
      installedApps.find(a => a.packageName === pkg)?.appName
      ?? selectedApps.find(a => a.packageName === pkg)?.appName
      ?? pkg;
    try {
      await store.saveBudget({
        id: `budget-${Date.now()}`,
        packageName: pkg,
        appLabel: label,
        kind: newBudgetKind,
        limit,
        enabled: true,
      });
      setBudgets(await store.getBudgets());
      await syncBudgetsToNative();
      setNewBudgetPkg('');
      setNewBudgetLimit(10);
      if (duplicate) {
        Alert.alert('Duplicate budget', 'This app + meter is already tracked. Both rows are kept.');
      }
    } catch {
      Alert.alert('Could not save budget', 'Storage failed. Please try again.');
    }
  };

  const handleUpdateBudget = async (id: string, patch: Partial<Budget>) => {
    const cur = budgets.find(b => b.id === id);
    if (!cur) return;
    tap();
    const merged: Budget = { ...cur, ...patch };
    // Row stepper stays 1..999; 0/disabled only happens via the add form or
    // the enabled switch (the store also normalizes limit <= 0 to disabled).
    if (patch.limit !== undefined) merged.limit = Math.min(999, Math.max(1, patch.limit));
    try {
      await store.saveBudget(merged);
      setBudgets(await store.getBudgets());
      await syncBudgetsToNative();
    } catch {
      Alert.alert('Could not save budget', 'Storage failed. Please try again.');
    }
  };

  const handleDeleteBudget = async (id: string) => {
    tap();
    try {
      await store.deleteBudget(id);
      setBudgets(await store.getBudgets());
      await syncBudgetsToNative();
    } catch {
      Alert.alert('Could not delete budget', 'Storage failed. Please try again.');
    }
  };

  // ── Wave 2C1 C: dumbphone allowlist (Pro flagship, per-task) ──
  const handleToggleAllowlist = () => {
    if (!isPro) {
      showWave2ProGate('Dumbphone mode is Pro.', 'Only chosen apps work.');
      return;
    }
    tap();
    setAllowlistMode(v => !v);
  };

  const handleOpenAllowlistPicker = () => {
    if (!isPro) {
      showWave2ProGate('Dumbphone mode is Pro.', 'Only chosen apps work.');
      return;
    }
    tap();
    setAllowlistPickerOpen(true);
  };

  const handleToggleAllowlistApp = (app: InstalledApp) => {
    tap();
    setAllowlistPkgs(prev => (
      prev.includes(app.packageName)
        ? prev.filter(p => p !== app.packageName)
        : [...prev, app.packageName]
    ));
  };

  const appLabelFor = (pkg: string) =>
    installedApps.find(a => a.packageName === pkg)?.appName
    ?? selectedApps.find(a => a.packageName === pkg)?.appName
    ?? pkg;

  // ── Wave 2C1 D: website blocking (Pro) ──
  const showDomainsProGate = () => {
    showWave2ProGate('Website blocking is Pro.', 'Block sites in browsers.');
  };

  const handleAddDomain = async () => {
    tap();
    if (!isPro) { showDomainsProGate(); return; }
    const d = newDomain.trim().toLowerCase();
    if (!d || !d.includes('.')) {
      setDomainError('Enter a valid domain, e.g. example.com');
      return;
    }
    setDomainError(null);
    try {
      await store.saveBlockedDomain({ id: `domain-${Date.now()}`, domain: d, enabled: true });
      setDomains(await store.getBlockedDomains());
      await syncDomainsToNative();
      setNewDomain('');
    } catch {
      Alert.alert('Could not save website', 'Storage failed. Please try again.');
    }
  };

  const handleToggleDomain = async (id: string) => {
    if (!isPro) { showDomainsProGate(); return; }
    const cur = domains.find(x => x.id === id);
    if (!cur) return;
    tap();
    try {
      await store.saveBlockedDomain({ ...cur, enabled: !cur.enabled });
      setDomains(await store.getBlockedDomains());
      await syncDomainsToNative();
    } catch {
      Alert.alert('Could not save website', 'Storage failed. Please try again.');
    }
  };

  const handleDeleteDomain = async (id: string) => {
    if (!isPro) { showDomainsProGate(); return; }
    tap();
    try {
      await store.deleteBlockedDomain(id);
      setDomains(await store.getBlockedDomains());
      await syncDomainsToNative();
    } catch {
      Alert.alert('Could not delete website', 'Storage failed. Please try again.');
    }
  };

  // ── Wave 2C1 E: feed shield (Pro) ──
  const showFeedsProGate = () => {
    showWave2ProGate('Feed Shield is Pro.', 'Hide reels & explore per app.');
  };

  const handleOpenFeedPicker = () => {
    if (!isPro) { showFeedsProGate(); return; }
    tap();
    setFeedPickerOpen(true);
  };

  const handleToggleFeedFlag = async (
    pkg: string,
    flag: 'hideReels' | 'hideExplore' | 'hideComments' | 'enabled',
  ) => {
    if (!isPro) { showFeedsProGate(); return; }
    const cur = feedFilters.find(f => f.packageName === pkg);
    if (!cur) return;
    tap();
    const next: FeedFilter = { ...cur };
    next[flag] = !next[flag];
    try {
      await store.saveFeedFilter(next);
      setFeedFilters(await store.getFeedFilters());
      await syncFeedsToNative();
    } catch {
      Alert.alert('Could not save feed filter', 'Storage failed. Please try again.');
    }
  };

  const handleAddFeedApp = async (app: InstalledApp) => {
    if (!isPro) { showFeedsProGate(); return; }
    if (feedFilters.some(f => f.packageName === app.packageName)) {
      Alert.alert('Already added', 'Feed Shield already covers this app.');
      return;
    }
    tap();
    try {
      await store.saveFeedFilter({
        packageName: app.packageName,
        hideReels: true,
        hideExplore: true,
        hideComments: false,
        enabled: true,
      });
      setFeedFilters(await store.getFeedFilters());
      await syncFeedsToNative();
      setFeedPickerOpen(false);
    } catch {
      Alert.alert('Could not save feed filter', 'Storage failed. Please try again.');
    }
  };

  const scheduleValid = scheduleDays.length >= 1 && startMinutes !== endMinutes;
  const scheduleHint = !scheduleEnabled
    ? null
    : scheduleDays.length === 0
      ? 'Pick at least one day.'
      : startMinutes === endMinutes
        ? "Start and end can't be the same."
        : null;

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const formOpacity = useSharedValue(0);
  const formTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    formOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    formTranslateY.value = withDelay(250, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(400, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const handleSave = async () => {
    tap();
    if (!taskName.trim()) return;
    // Manual override wins; otherwise use the picked app(s).
    const rawPkgs = selectedApps.length > 0
      ? selectedApps.map(a => a.packageName)
      : (packageName.trim() ? [packageName.trim()] : []);
    if (rawPkgs.length === 0) return;
    if (scheduleEnabled && !scheduleValid) return;
    // Safety net: free tier can never persist more than one blocked app
    // (e.g. legacy Pro multi-task edited after expiry).
    const pkgs = isSubscribed ? rawPkgs : rawPkgs.slice(0, 1);
    const firstApp = selectedApps.find(a => a.packageName === pkgs[0])?.appName
      || appName.trim() || pkgs[0];
    const taskId = existingTask ? existingTask.id : `task-${Date.now()}`;
    // Free tier forces the schedule off at save — except preset schedules,
    // which are free by design (Wave 2C1 A).
    const effectiveScheduleEnabled = scheduleEnabled && (isPro || scheduleFromPreset);

    try {
      let saved: Task;
      if (existingTask) {
        saved = { ...existingTask, name: taskName.trim(), packageName: pkgs[0], appName: firstApp, blockedPackages: pkgs, strict: isPro ? strict : false, allowlistMode: isPro ? allowlistMode : false, allowlist: isPro ? allowlistPkgs : undefined };
        await store.saveTask(saved);
      } else {
        saved = {
          id: taskId,
          name: taskName.trim(),
          packageName: pkgs[0],
          appName: firstApp,
          blockedPackages: pkgs,
          strict: isPro ? strict : false,
          allowlistMode: isPro ? allowlistMode : false,
          allowlist: isPro ? allowlistPkgs : undefined,
          createdAt: Date.now(),
          lastUsed: 0,
          useCount: 0,
          isActive: true,
          streak: 0,
        };
        await store.saveTask(saved);
      }
      // Tile staleness: the tile's toggle target is the mirror's lastPackages —
      // re-push on every edit/save so renames and app-list changes land.
      await syncWidgetNow(saved).catch(() => {});
    } catch {
      Alert.alert('Could not save task', 'Storage failed. Please try again.');
      return;
    }
    try {
      if (existingScheduleId) {
        await store.saveSchedule({
          id: existingScheduleId,
          taskId,
          days: scheduleDays,
          startMinutes,
          endMinutes,
          enabled: effectiveScheduleEnabled,
        });
      } else if (effectiveScheduleEnabled) {
        await store.saveSchedule({
          id: `sched-${Date.now()}`,
          taskId,
          days: scheduleDays,
          startMinutes,
          endMinutes,
          enabled: true,
        });
      }
    } catch {
      // Best-effort; the task itself already saved.
    }
    await syncSchedulesToNative();
    navigation.goBack();
  };

  const handleDelete = () => {
    if (!existingTask) return;
    tap('medium');
    Alert.alert('Delete this task?', 'Its schedules go too. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const schedules = await store.getSchedulesForTask(existingTask.id);
            for (const s of schedules) {
              await store.deleteSchedule(s.id).catch(() => {});
            }
            await store.deleteTask(existingTask.id);
          } catch {
            Alert.alert('Could not delete task', 'Storage failed. Please try again.');
            return;
          }
          await syncSchedulesToNative();
          navigation.goBack();
        },
      },
    ]);
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const formAnimStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const border = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const canSave = taskName.trim() && (selectedApps.length > 0 || packageName.trim()) && (!scheduleEnabled || scheduleValid);

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backIcon} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeftIcon size={24} color={ink} />
          </TouchableOpacity>
          <Text style={[typography.display, { color: ink }]}>
            {existingTask ? 'EDIT TASK' : 'NEW TASK'}
          </Text>
          <View style={{ width: 60 }} />
        </View>
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.form, formAnimStyle]}>
          <Text style={[typography.displaySmall, { color: ink, marginBottom: spacing.md }]}>
            TASK NAME
          </Text>
          <View style={styles.nameRow}>
            <View style={styles.taskGlyphBox}>
              <TaskGlyph name={taskName || existingTask?.name || ''} size={22} color={colors.midnight} />
            </View>
            <TextInput
              style={[styles.input, styles.nameInput, { color: ink, backgroundColor: cardBg, borderColor: border }]}
              placeholder="e.g. Deep Work"
              placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
              value={taskName}
              onChangeText={setTaskName}
            />
          </View>

          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            INSTALLED APPS
          </Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { tap(); setAppPickerOpen(true); }}
            style={[styles.input, styles.appPickerField, { backgroundColor: cardBg, borderColor: border }]}
            accessibilityRole="button"
            accessibilityLabel="Choose apps to block"
          >
            <Text
              style={[typography.body, { color: selectedApps.length > 0 ? ink : muted, flex: 1 }]}
              numberOfLines={1}
            >
              {selectedApps.length > 0
                ? selectedApps.map(a => a.appName).join(', ')
                : 'Search apps...'}
            </Text>
          </TouchableOpacity>
          <Modal
            visible={appPickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setAppPickerOpen(false)}
          >
            <TouchableWithoutFeedback onPress={() => { setAppPickerOpen(false); Keyboard.dismiss(); }}>
              <View style={styles.pickerBackdrop}>
                <TouchableWithoutFeedback>
                  <View style={[styles.pickerCard, { backgroundColor: cardBg, borderColor: border }]}>
                    <TextInput
                      style={[styles.input, { color: ink, borderColor: border, marginBottom: spacing.sm }]}
                      placeholder="Search apps..."
                      placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
                      value={appSearchQuery}
                      onChangeText={setAppSearchQuery}
                      autoFocus
                    />
                    {filteredApps.length === 0 ? (
                      <View style={styles.noAppsFound}>
                        {isDark && (
                          <Image source={mascotSource('thinking', isDark)} style={styles.noAppsImage} resizeMode="contain" />
                        )}
                        <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkMuted, paddingVertical: spacing.md, textAlign: 'center' }]}>
                          No apps found
                        </Text>
                      </View>
                    ) : (
                      <FlatList
                        data={filteredApps}
                        keyExtractor={(app) => app.packageName}
                        initialNumToRender={20}
                        maxToRenderPerBatch={20}
                        windowSize={7}
                        removeClippedSubviews
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item: app }) => {
                          const checked = selectedApps.some(a => a.packageName === app.packageName);
                          return (
                            <TouchableOpacity
                              activeOpacity={0.7}
                              onPress={() => handlePickApp(app)}
                              style={[
                                styles.appRow,
                                {
                                  backgroundColor: checked
                                    ? isDark
                                      ? 'rgba(255,255,255,0.06)'
                                      : 'rgba(28,176,246,0.08)'
                                    : 'transparent',
                                  borderRadius: radius.sm,
                                },
                              ]}
                            >
                              <View style={[styles.checkbox, { borderColor: border }, checked && styles.checkboxChecked]}>
                                {checked && (
                                  <CheckIcon size={14} color={colors.midnight} />
                                )}
                              </View>
                              {app.iconBase64 ? (
                                <Image
                                  source={{ uri: `data:image/png;base64,${app.iconBase64}` }}
                                  style={styles.appIcon}
                                />
                              ) : (
                                <View style={styles.appIconFallback}>
                                  <TaskGlyph name={app.appName} size={18} color={colors.midnight} />
                                </View>
                              )}
                              <View style={styles.appInfo}>
                                <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>
                                  {app.appName}
                                </Text>
                              </View>
                            </TouchableOpacity>
                          );
                        }}
                      />
                    )}
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </Modal>

          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            PACKAGE NAME (MANUAL OVERRIDE)
          </Text>
          <TextInput
            style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border }]}
            placeholder="e.g., com.instagram.android"
            placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
            value={packageName}
            onChangeText={(text) => { setPackageName(text); setAppName(''); setSelectedApps([]); }}
          />
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            STRICT MODE{!isPro ? ' · PRO' : ''}
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleStrict}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: strict }}
              accessibilityLabel="Enable strict mode"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  Lock this task in
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  No overrides. No escape.
                </Text>
              </View>
              <View style={[styles.toggleTrack, { borderColor: border }, strict && styles.toggleTrackOn]}>
                <View style={[styles.toggleKnob, strict && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            QUICK PRESETS
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => applySchedulePreset('bedtime')}
              disabled={presetBusy}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Apply bedtime preset 11 PM to 7 AM"
            >
              <Text style={[typography.bodyMedium, { color: ink }]}>
                Bedtime 23:00–07:00
              </Text>
              <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                Nightly
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => applySchedulePreset('work')}
              disabled={presetBusy}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Apply work hours preset 9 AM to 5 PM weekdays"
            >
              <Text style={[typography.bodyMedium, { color: ink }]}>
                Work hours 09:00–17:00 weekdays
              </Text>
              <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                Weekdays
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={applySprintPreset}
              disabled={presetBusy}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Start a one-shot 25 minute block from now"
            >
              <Text style={[typography.bodyMedium, { color: ink }]}>
                Focus sprint · 25 min
              </Text>
              <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                Today only
              </Text>
            </TouchableOpacity>
            {presetNote && (
              <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                {presetNote}
              </Text>
            )}
          </View>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            SCHEDULE{!isPro ? ' · PRO' : ''}
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleSchedule}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: scheduleEnabled }}
              accessibilityLabel="Enable schedule"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  Enable schedule
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Auto-block on schedule
                </Text>
              </View>
              <View style={[styles.toggleTrack, { borderColor: border }, scheduleEnabled && styles.toggleTrackOn]}>
                <View style={[styles.toggleKnob, scheduleEnabled && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            {scheduleEnabled && (
              <>
                <View style={styles.dayRow}>
                  {DAY_ORDER.map((day, i) => {
                    const on = scheduleDays.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        activeOpacity={0.7}
                        onPress={() => handleToggleDay(day)}
                        style={[styles.dayChip, { borderColor: border }, on && styles.dayChipOn]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`Day ${day}`}
                      >
                        <Text style={[styles.dayChipText, { color: on ? colors.midnight : ink }]}>
                          {DAY_LABELS[i]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.timeRow}>
                  <Text style={[typography.label, { color: ink }]}>START</Text>
                  <View style={styles.stepperGroup}>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('start', -1)} accessibilityRole="button" accessibilityLabel="Decrease start hour">
                      <Text style={[styles.stepperText, { color: ink }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.timeText, { color: ink }]}>{formatScheduleTime(startMinutes)}</Text>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('start', 1)} accessibilityRole="button" accessibilityLabel="Increase start hour">
                      <Text style={[styles.stepperText, { color: ink }]}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.minuteBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => cycleMinute('start')} accessibilityRole="button" accessibilityLabel="Cycle start minutes">
                      <Text style={[styles.minuteText, { color: ink }]}>:{String(startMinutes % 60).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.timeRow}>
                  <Text style={[typography.label, { color: ink }]}>END</Text>
                  <View style={styles.stepperGroup}>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('end', -1)} accessibilityRole="button" accessibilityLabel="Decrease end hour">
                      <Text style={[styles.stepperText, { color: ink }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.timeText, { color: ink }]}>{formatScheduleTime(endMinutes)}</Text>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('end', 1)} accessibilityRole="button" accessibilityLabel="Increase end hour">
                      <Text style={[styles.stepperText, { color: ink }]}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.minuteBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => cycleMinute('end')} accessibilityRole="button" accessibilityLabel="Cycle end minutes">
                      <Text style={[styles.minuteText, { color: ink }]}>:{String(endMinutes % 60).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {scheduleHint && (
                  <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
                    {scheduleHint}
                  </Text>
                )}
              </>
            )}
          </View>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            DAILY BUDGETS
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            {budgets.length === 0 ? (
              <Text style={[typography.caption, { color: muted }]}>
                No budgets yet.
              </Text>
            ) : budgets.map(b => {
              const u = budgetUsage[b.packageName];
              const used = b.kind === 'opens' ? u?.opens : u?.minutes;
              const unit = b.kind === 'opens' ? 'opens' : 'min';
              return (
                <View key={b.id} style={styles.budgetRow}>
                  <View style={styles.rowBetween}>
                    <Text style={[typography.bodyMedium, { color: ink, flex: 1 }]} numberOfLines={1}>
                      {`${b.appLabel} · ${b.limit} ${unit}/day${used !== undefined ? ` · ${used} used` : ''}`}
                    </Text>
                    <RowSwitch
                      on={b.enabled}
                      onPress={() => handleUpdateBudget(b.id, { enabled: !b.enabled })}
                      border={border}
                      label={`${b.appLabel} budget ${b.enabled ? 'on' : 'off'}`}
                    />
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => handleDeleteBudget(b.id)}
                      style={styles.deleteTextBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`Delete budget for ${b.appLabel}`}
                    >
                      <Text style={[typography.h3, { color: colors.danger }]}>
                        ×
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.rowBetween}>
                    <View style={styles.stepperGroup}>
                      <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => handleUpdateBudget(b.id, { limit: b.limit - 1 })} accessibilityRole="button" accessibilityLabel="Lower limit">
                        <Text style={[styles.stepperText, { color: ink }]}>−</Text>
                      </TouchableOpacity>
                      <Text style={[styles.timeText, { color: ink }]}>{b.limit}</Text>
                      <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => handleUpdateBudget(b.id, { limit: b.limit + 1 })} accessibilityRole="button" accessibilityLabel="Raise limit">
                        <Text style={[styles.stepperText, { color: ink }]}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })}
            <TextInput
              style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border, marginTop: spacing.md }]}
              placeholder="Package, e.g. com.instagram.android"
              placeholderTextColor={muted}
              value={newBudgetPkg}
              onChangeText={setNewBudgetPkg}
              autoCapitalize="none"
            />
            {selectedApps.length > 0 && selectedApps[0] && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => {
                  setNewBudgetPkg(selectedApps[0].packageName);
                }}
                style={styles.linkBtn}
              >
                <Text style={[typography.caption, { color: muted }]}>
                  Use {selectedApps[0].appName}
                </Text>
              </TouchableOpacity>
            )}
            <View style={styles.dayRow}>
              {(['opens', 'minutes'] as const).map(k => {
                const on = newBudgetKind === k;
                return (
                  <TouchableOpacity
                    key={k}
                    activeOpacity={0.7}
                    onPress={() => { tap(); setNewBudgetKind(k); }}
                    style={[styles.dayChip, { borderColor: border }, on && styles.dayChipOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Budget meter ${k}`}
                  >
                    <Text style={[styles.dayChipText, { color: on ? colors.midnight : ink }]}>
                      {k === 'opens' ? 'OPENS' : 'MIN'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.timeRow}>
              <Text style={[typography.label, { color: ink }]}>LIMIT</Text>
              <View style={styles.stepperGroup}>
                <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => { tap(); setNewBudgetLimit(v => Math.max(1, v - 1)); }} accessibilityRole="button" accessibilityLabel="Lower new budget limit">
                  <Text style={[styles.stepperText, { color: ink }]}>−</Text>
                </TouchableOpacity>
                <Text style={[styles.timeText, { color: ink }]}>{newBudgetLimit}</Text>
                <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => { tap(); setNewBudgetLimit(v => Math.min(999, v + 1)); }} accessibilityRole="button" accessibilityLabel="Raise new budget limit">
                  <Text style={[styles.stepperText, { color: ink }]}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleAddBudget}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Add budget"
            >
              <Text style={[typography.bodyMedium, { color: ink, textAlign: 'center' }]}>
                ADD BUDGET
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            DUMBPHONE MODE · PRO
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleAllowlist}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: allowlistMode }}
              accessibilityLabel="Enable dumbphone mode"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  Only allowed apps work
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Rest is blocked
                </Text>
              </View>
              <View style={[styles.toggleTrack, { borderColor: border }, allowlistMode && styles.toggleTrackOn]}>
                <View style={[styles.toggleKnob, allowlistMode && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={[!isPro && styles.grayed]}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleOpenAllowlistPicker}
                style={[styles.presetBtn, { borderColor: border }]}
                accessibilityRole="button"
                accessibilityLabel="Choose allowed apps"
              >
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  {allowlistPkgs.length > 0 ? `${allowlistPkgs.length} app${allowlistPkgs.length === 1 ? '' : 's'} allowed` : 'Choose allowed apps…'}
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]} numberOfLines={2}>
                  {allowlistPkgs.length > 0 ? allowlistPkgs.map(appLabelFor).join(', ') : 'No apps chosen yet'}
                </Text>
              </TouchableOpacity>
              {allowlistMode && allowlistPkgs.length === 0 && (
                <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
                  Empty = all blocked but phone & StayT
                </Text>
              )}
            </View>
          </View>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            WEBSITES · PRO
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            {domains.length === 0 ? (
              <Text style={[typography.caption, { color: muted }]}>
                No blocked sites yet.
              </Text>
            ) : domains.map(d => (
              <View key={d.id} style={styles.rowBetween}>
                <View style={styles.rowMain}>
                  <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>
                    {d.domain}
                  </Text>
                </View>
                <RowSwitch
                  on={d.enabled}
                  onPress={() => handleToggleDomain(d.id)}
                  border={border}
                  label={`Block ${d.domain} ${d.enabled ? 'enabled' : 'disabled'}`}
                />
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => handleDeleteDomain(d.id)}
                  style={styles.deleteTextBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${d.domain}`}
                >
                  <Text style={[typography.caption, { color: colors.danger }]}>
                    DELETE
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
            <TextInput
              style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border, marginTop: spacing.md }]}
              placeholder="example.com"
              placeholderTextColor={muted}
              value={newDomain}
              onChangeText={t => { setNewDomain(t); if (domainError) setDomainError(null); }}
              autoCapitalize="none"
              keyboardType="url"
            />
            {domainError && (
              <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
                {domainError}
              </Text>
            )}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleAddDomain}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Add website"
            >
              <Text style={[typography.bodyMedium, { color: ink, textAlign: 'center' }]}>
                ADD WEBSITE
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            FEED SHIELD · PRO
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[typography.caption, { color: muted }]}>
              Off if glitchy.
            </Text>
            {feedFilters.length === 0 ? (
              <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                No apps shielded yet.
              </Text>
            ) : feedFilters.map(f => (
              <View key={f.packageName} style={styles.budgetRow}>
                <View style={styles.rowBetween}>
                  <View style={styles.rowMain}>
                    <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>
                      {appLabelFor(f.packageName)}
                    </Text>
                    <Text style={[typography.caption, { color: muted, marginTop: 2 }]} numberOfLines={1}>
                      {f.packageName}
                    </Text>
                  </View>
                  <RowSwitch
                    on={f.enabled}
                    onPress={() => handleToggleFeedFlag(f.packageName, 'enabled')}
                    border={border}
                    label={`Feed Shield for ${f.packageName} ${f.enabled ? 'enabled' : 'disabled'}`}
                  />
                </View>
                {([['hideReels', 'Hide Reels'], ['hideExplore', 'Hide Explore'], ['hideComments', 'Hide Comments']] as const).map(([flag, label]) => (
                  <View key={flag} style={styles.rowBetween}>
                    <Text style={[typography.body, { color: ink }]}>
                      {label}
                    </Text>
                    <RowSwitch
                      on={f[flag]}
                      onPress={() => handleToggleFeedFlag(f.packageName, flag)}
                      border={border}
                      label={`${label} for ${f.packageName}`}
                    />
                  </View>
                ))}
              </View>
            ))}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleOpenFeedPicker}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Add app to Feed Shield"
            >
              <Text style={[typography.bodyMedium, { color: ink, textAlign: 'center' }]}>
                ADD APP
              </Text>
            </TouchableOpacity>
          </View>
          <AppSelectModal
            visible={allowlistPickerOpen}
            onClose={() => setAllowlistPickerOpen(false)}
            onPick={handleToggleAllowlistApp}
            apps={installedApps}
            picked={allowlistPkgs}
            cardBg={cardBg}
            border={border}
            ink={ink}
            muted={muted}
            placeholder="Search allowed apps..."
          />
          <AppSelectModal
            visible={feedPickerOpen}
            onClose={() => setFeedPickerOpen(false)}
            onPick={handleAddFeedApp}
            apps={installedApps}
            picked={feedFilters.map(f => f.packageName)}
            cardBg={cardBg}
            border={border}
            ink={ink}
            muted={muted}
            placeholder="Search apps..."
          />
        </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: canSave ? 1 : 0.5, backgroundColor: isDark ? '#ffffff' : colors.ectoGreen, borderBottomWidth: isDark ? 0 : 3 }]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!canSave}
          onPressIn={canSave ? handlePressIn : undefined}
          onPressOut={canSave ? handlePressOut : undefined}
        >
          <Text style={styles.primaryButtonText}>SAVE TASK</Text>
        </AnimatedTouchable>
        {existingTask && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleDelete}
            style={styles.deleteButton}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${existingTask.name}`}
          >
            <Text style={[typography.cta, { color: colors.danger, textAlign: 'center' }]}>
              DELETE TASK
            </Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: layout.headerPaddingTop,
    paddingBottom: layout.safeAreaBottom,
  },
  header: {
    marginBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backIcon: {
    width: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  form: {},
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  taskGlyphBox: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameInput: {
    flex: 1,
  },
  input: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    ...typography.body,
  },
  appPickerField: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pickerCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    maxHeight: '70%',
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  appIconFallback: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  appInfo: {
    flex: 1,
  },
  noAppsFound: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  noAppsImage: {
    width: 130,
    height: 130,
  },
  scheduleCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  scheduleToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  scheduleToggleText: {
    flex: 1,
  },
  toggleTrack: {
    width: 52,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: '#999',
    alignSelf: 'flex-start',
  },
  toggleKnobOn: {
    backgroundColor: colors.midnight,
    alignSelf: 'flex-end',
  },
  dayRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  dayChip: {
    flex: 1,
    minHeight: 44,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayChipOn: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  dayChipText: {
    ...typography.h3,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    minHeight: 44,
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperText: {
    ...typography.button,
  },
  timeText: {
    ...typography.h3,
    minWidth: 58,
    textAlign: 'center',
  },
  minuteBtn: {
    height: 44,
    minWidth: 52,
    paddingHorizontal: spacing.sm,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  minuteText: {
    ...typography.h3,
  },
  bottomSection: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 18,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButtonText: {
    ...typography.cta,
    color: colors.midnight,
    textAlign: 'center',
  },
  deleteButton: {
    paddingVertical: spacing.lg,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: 'transparent',
  },
  // ── Wave 2C1 additive styles (reuse radius/spacing/typography above) ──
  presetBtn: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  budgetRow: {
    marginTop: spacing.md,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    gap: spacing.sm,
    minHeight: 44,
  },
  rowMain: {
    flex: 1,
  },
  grayed: {
    opacity: 0.55,
  },
  linkBtn: {
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  deleteTextBtn: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
