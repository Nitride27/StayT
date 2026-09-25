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
import { TaskGlyph, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/icons';
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
        ...(s.onceStart && s.onceEnd ? { onceStart: s.onceStart, onceEnd: s.onceEnd } : {}),
      }));
    await AppBlocker.setSchedules(payload).catch(() => {});
  } catch {
    // Best-effort; a failed push must never block the save flow.
  }
}

// Wave 2C1 mirrors of syncSchedulesToNative: the store is the source of
// truth, native persists nothing. Every push is best-effort. Only enforceable
// (task-tagged + enabled + limit>0) budgets push — never via startBlocking.
async function syncBudgetsToNative(): Promise<void> {
  try {
    const all = await store.getEnforceableBudgets();
    await AppBlocker.setBudgets(all).catch(() => {});
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

// Disclosure row: section title + live summary subtitle + a chevron that
// rotates when open. One tappable 44px target, tokens only, no disclosure
// text. The subtitle keeps layout stable via numberOfLines={1}; critical
// warnings render outside the row so they stay visible while collapsed.
function SectionRow(props: { open: boolean; title: string; summary: string; ink: string; muted: string; onPress: () => void; label: string }) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={props.onPress}
      style={[styles.rowBetween, { marginTop: spacing.xl, marginBottom: spacing.xs }]}
      accessibilityRole="button"
      accessibilityState={{ expanded: props.open }}
      accessibilityLabel={`${props.label}, ${props.summary}`}
    >
      <View style={styles.sectionRowText}>
        <Text style={[typography.displaySmall, { color: props.ink }]} numberOfLines={1}>
          {props.title}
        </Text>
        <Text style={[typography.caption, { color: props.muted, marginTop: 2 }]} numberOfLines={1}>
          {props.summary}
        </Text>
      </View>
      <View style={{ transform: [{ rotate: props.open ? '90deg' : '0deg' }] }}>
        <ChevronRightIcon size={20} color={props.muted} />
      </View>
    </TouchableOpacity>
  );
}

// Shared installed-app picker modal for the allowlist + feed + budget cards.
// Exported for reuse — never clone for a second picker.
export function AppSelectModal(props: {
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
  loading?: boolean;
}) {
  const [q, setQ] = useState('');
  const { isDark } = useTheme();
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
        <View style={[styles.pickerBackdrop, { backgroundColor: isDark ? darkColors.overlay : colors.overlay }]}>
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
                    {props.loading ? 'Loading apps…' : 'No apps found'}
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
                          backgroundColor: checked ? colors.ectoGreen + '1A' : 'transparent',
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
  // Stable id for task-wise budgets: existing task keeps its id; a new task
  // reuses this draft id at save so budgets added pre-save stay attached.
  const [draftTaskId] = useState(() => existingTask?.id ?? `task-${Date.now()}`);
  const currentTaskId = existingTask?.id ?? draftTaskId;
  const [taskName, setTaskName] = useState(existingTask?.name || '');
  const [packageName, setPackageName] = useState(existingTask?.packageName || '');
  const [appName, setAppName] = useState(existingTask?.appName || '');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(installedAppsCache !== null);
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
  // A saved task stores one app name (the first app); the rest seed with
  // their package id ("com.android.chrome"). Swap in real names once the
  // installed-app list is in.
  useEffect(() => {
    if (installedApps.length === 0) return;
    const names = new Map(installedApps.map(a => [a.packageName, a.appName]));
    setSelectedApps(prev =>
      prev.some(a => a.appName === a.packageName && names.has(a.packageName))
        ? prev.map(a => (a.appName === a.packageName ? { ...a, appName: names.get(a.packageName) ?? a.appName } : a))
        : prev,
    );
  }, [installedApps]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startMinutes, setStartMinutes] = useState(9 * 60);
  const [endMinutes, setEndMinutes] = useState(17 * 60);
  const [existingScheduleId, setExistingScheduleId] = useState<string | null>(null);
  // P1-1 hardcore strict mode (Pro): no override or break escape.
  const [strict, setStrict] = useState(existingTask?.strict === true);
  // Dumbphone Mode (per-task): strict blocking, nothing counts. One boolean
  // drives the grey-out of every other setup section below; the allowlist
  // nests inside the dumbphone card (a dumbphone still needs essentials).
  const [dumb, setDumb] = useState(existingTask?.dumbphoneMode === true);
  // ── Wave 2C1 A: schedule presets (free) ──
  const [scheduleFromPreset, setScheduleFromPreset] = useState(false);
  const [presetNote, setPresetNote] = useState<string | null>(null);
  // Set only by the Focus sprint preset: a one-time window (epoch ms). Any
  // manual day/time edit or another preset turns it back into a weekly one.
  const [onceWindow, setOnceWindow] = useState<{ start: number; end: number } | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  // ── Wave 2C1 C: dumbphone allowlist (Pro flagship, per-task) ──
  const [allowlistMode, setAllowlistMode] = useState(existingTask?.allowlistMode === true);
  const [allowlistPkgs, setAllowlistPkgs] = useState<string[]>(existingTask?.allowlist ?? []);
  const [allowlistPickerOpen, setAllowlistPickerOpen] = useState(false);
  // ── Wave 2C1 B/D/E: task-scoped budgets + global domains/feed filters ──
  // Budgets here are this task's rows only (no global path remains).
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
  // Product-clarity Q2: budget creation reuses AppSelectModal (no twin picker).
  const [budgetPickerOpen, setBudgetPickerOpen] = useState(false);
  // Product-clarity Q4: pkgs where the hard block wins over feed/budget.
  // Collision notes are about THIS task only: its own block list vs its
  // budgets / the global feed shields (other tasks' lists never run in this
  // task's session, so they must not warn here).
  const thisTaskBlocked = new Set(selectedApps.map(a => a.packageName));
  const budgetCollisions = [...new Set(budgets.map(b => b.packageName).filter(p => thisTaskBlocked.has(p)))];
  const feedCollisions = feedFilters
    .filter(f => f.enabled === true && thisTaskBlocked.has(f.packageName))
    .map(f => f.packageName);
  // Declutter: progressive disclosure — advanced sections collapsed by default.
  // Visibility only; save/store/navigation/push logic below is untouched.
  const [showManualPkg, setShowManualPkg] = useState(false);
  const [showBudgets, setShowBudgets] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showDomains, setShowDomains] = useState(false);
  const [showFeeds, setShowFeeds] = useState(false);

  // Wave 2C1 lists — (re)load on mount and on focus. Budgets are scoped to
  // this task (getBudgetsForTask); domains/feeds stay global. Native pushes
  // ride their own sync fns, never the session path.
  const refreshWave2Lists = useCallback(() => {
    store.getBudgetsForTask(currentTaskId).then(setBudgets).catch(() => {});
    store.getBlockedDomains().then(setDomains).catch(() => {});
    store.getFeedFilters().then(setFeedFilters).catch(() => {});
    AppBlocker.getBudgetUsage().then(u => setBudgetUsage(u ?? {})).catch(() => {});
  }, [currentTaskId]);

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
        if (live) { setInstalledApps(apps); setAppsLoaded(true); }
      })
      .catch(() => { if (live && !installedAppsCache) { setInstalledApps([]); setAppsLoaded(true); } });
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
        const once = s.onceStart && s.onceEnd ? { start: s.onceStart, end: s.onceEnd } : null;
        setOnceWindow(once);
        // A finished one-time sprint reads as off, not as a weekly schedule.
        setScheduleEnabled(s.enabled && !(once && once.end <= Date.now()));
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
  const taskBudgets = budgets;

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

  // Dumbphone Mode (per-task, ungated like the former global dumfound):
  // strict blocking, nothing counts. Locks the rest of this task's setup.
  const handleToggleDumbphone = () => {
    tap();
    setDumb(v => !v);
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
    setOnceWindow(null);
    setScheduleDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const adjustHour = (which: 'start' | 'end', delta: number) => {
    if (!isPro) { showScheduleProGate(); return; }
    tap();
    setOnceWindow(null);
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
    setOnceWindow(null);
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
    setOnceWindow(null);
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

  // Focus sprint: a ONE-TIME 25-min window starting now. Stored with
  // onceStart/onceEnd, so it fires once and never repeats (it used to save
  // as a weekly schedule on today's weekday and block again next week).
  // Crossing midnight is fine: the window is absolute time.
  const applySprintPreset = () => {
    if (presetBusy) return;
    setPresetBusy(true);
    tap();
    const start = Date.now();
    const end = start + 25 * 60 * 1000;
    const minutesOf = (ms: number) => {
      const d = new Date(ms);
      return d.getHours() * 60 + d.getMinutes();
    };
    setOnceWindow({ start, end });
    setScheduleDays([new Date(start).getDay()]);
    setStartMinutes(minutesOf(start));
    setEndMinutes(minutesOf(end));
    setScheduleEnabled(true);
    setScheduleFromPreset(true);
    setPresetNote(`Once, ${formatScheduleTime(minutesOf(start))}–${formatScheduleTime(minutesOf(end))}`);
    setPresetBusy(false);
  };

  // ── Wave 2C1 B: daily budgets (free: 1 budgeted app for this task) ──
  // Task-wise organization: new rows auto-tag with currentTaskId.
  // Enforcement reads the enforceable set via syncBudgetsToNative.
  const showBudgetProGate = () => {
    Alert.alert('One budget on Free', 'Free: 1 app. Pro: unlimited.', [
      { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Re-push feeds after any write that may have auto-disabled a shield row
  // (saveFeedFilter / saveTask / saveBudget all reconcile internally).
  const refreshFeedsAndPush = async (): Promise<void> => {
    try {
      setFeedFilters(await store.getFeedFilters());
    } catch {
      // Best-effort.
    }
    await syncFeedsToNative();
  };

  const handleAddBudget = async () => {
    tap();
    const pkg = newBudgetPkg.trim();
    if (!pkg) {
      Alert.alert('Pick an app', 'Choose an app with the picker above.');
      return;
    }
    if (!isPro && budgets.length >= 1) { showBudgetProGate(); return; }
    const limit = Math.min(999, Math.max(1, newBudgetLimit));
    const duplicate = taskBudgets.some(b => b.packageName === pkg && b.kind === newBudgetKind);
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
        taskId: currentTaskId,
      });
      setBudgets(await store.getBudgetsForTask(currentTaskId));
      await syncBudgetsToNative();
      await refreshFeedsAndPush();
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
      setBudgets(await store.getBudgetsForTask(currentTaskId));
      await syncBudgetsToNative();
      await refreshFeedsAndPush();
    } catch {
      Alert.alert('Could not save budget', 'Storage failed. Please try again.');
    }
  };

  const handleDeleteBudget = async (id: string) => {
    tap();
    try {
      await store.deleteBudget(id);
      setBudgets(await store.getBudgetsForTask(currentTaskId));
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
    showWave2ProGate('Feed Shield is Pro.', 'Cleans reels, explore and comments per app.');
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
    const taskId = currentTaskId;
    // Free tier forces the schedule off at save — except preset schedules,
    // which are free by design (Wave 2C1 A).
    const effectiveScheduleEnabled = scheduleEnabled && (isPro || scheduleFromPreset);

    try {
      let saved: Task;
      // Allowed apps only run inside Dumbphone Mode: the flag is forced off
      // when dumb is off (the list stays stored but inactive — the session
      // push path already follows task.allowlistMode).
      const dumbPatch = { dumbphoneMode: dumb };
      if (existingTask) {
        saved = { ...existingTask, name: taskName.trim(), packageName: pkgs[0], appName: firstApp, blockedPackages: pkgs, strict: isPro ? strict : false, allowlistMode: isPro && dumb ? allowlistMode : false, allowlist: isPro ? allowlistPkgs : undefined, ...dumbPatch } as Task;
        await store.saveTask(saved);
      } else {
        saved = {
          id: taskId,
          name: taskName.trim(),
          packageName: pkgs[0],
          appName: firstApp,
          blockedPackages: pkgs,
          strict: isPro ? strict : false,
          allowlistMode: isPro && dumb ? allowlistMode : false,
          allowlist: isPro ? allowlistPkgs : undefined,
          ...dumbPatch,
          createdAt: Date.now(),
          lastUsed: 0,
          useCount: 0,
          isActive: true,
          streak: 0,
        } as Task;
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
          ...(onceWindow ? { onceStart: onceWindow.start, onceEnd: onceWindow.end } : {}),
        });
      } else if (effectiveScheduleEnabled) {
        await store.saveSchedule({
          id: `sched-${Date.now()}`,
          taskId,
          days: scheduleDays,
          startMinutes,
          endMinutes,
          enabled: true,
          ...(onceWindow ? { onceStart: onceWindow.start, onceEnd: onceWindow.end } : {}),
        });
      }
    } catch {
      // Best-effort; the task itself already saved.
    }
    await syncSchedulesToNative();
    await syncFeedsToNative();
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
  // Dumbphone grey-out greys TEXT too: locked sections render labels/values
  // in muted (not just container opacity) so nothing looks tappable. When
  // dumb is off this equals ink — zero visual change.
  const lockedInk = dumb ? muted : ink;
  const canSave = taskName.trim() && (selectedApps.length > 0 || packageName.trim()) && (!scheduleEnabled || scheduleValid);
  const saveHint = !taskName.trim()
    ? 'Name your task to save.'
    : selectedApps.length === 0 && !packageName.trim()
      ? 'Choose an app to block.'
      : scheduleEnabled && !scheduleValid
        ? 'Fix the schedule to save.'
        : null;
  // Per-row collision lookup: reuse the section arrays, one Set per render —
  // no extra store calls inside the row maps below.
  const budgetCollisionSet = new Set(budgetCollisions);
  const feedCollisionSet = new Set(feedCollisions);

  // Live disclosure subtitles — derived from existing state only, no new
  // store calls. Each SectionRow shows one of these under its title.
  const scheduleDaySummary = (() => {
    const s = new Set(scheduleDays);
    if (scheduleDays.length === 0) return 'No days';
    if (scheduleDays.length === 7) return 'Daily';
    if (scheduleDays.length === 5 && [1, 2, 3, 4, 5].every(d => s.has(d))) return 'Weekdays';
    if (scheduleDays.length === 2 && s.has(0) && s.has(6)) return 'Weekends';
    // Any other set: name the days ("Thu", "Mon, Wed") — "1 days" read wrong.
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return [...scheduleDays].sort((x, y) => x - y).map(d => names[d]).join(', ');
  })();
  const scheduleSummary = !scheduleEnabled
    ? 'Off'
    : `${onceWindow ? 'Once' : scheduleDaySummary} · ${formatScheduleTime(startMinutes)}–${formatScheduleTime(endMinutes)}`;
  const budgetSummary = taskBudgets.length === 0
    ? 'Off'
    : `${taskBudgets.length} app${taskBudgets.length === 1 ? '' : 's'}`;
  const domainsSummary = domains.length === 0
    ? 'Off'
    : `${domains.length} site${domains.length === 1 ? '' : 's'}`;
  const enabledFeedCount = feedFilters.filter(f => f.enabled).length;
  const feedSummary = enabledFeedCount === 0
    ? 'Off'
    : `${enabledFeedCount} app${enabledFeedCount === 1 ? '' : 's'}`;
  const manualSummary = packageName.trim() ? packageName.trim() : 'Off';

  // Single budget-row renderer for this task's rows. Enforcement reads the
  // enforceable set via syncBudgetsToNative.
  const renderBudgetRow = (b: Budget) => {
    const u = budgetUsage[b.packageName];
    const used = b.kind === 'opens' ? u?.opens : u?.minutes;
    const unit = b.kind === 'opens' ? 'opens' : 'min';
    return (
      <View key={b.id} style={styles.budgetRow}>
        <View style={styles.rowBetween}>
          {/* A budget on an app this task already blocks has no effect: red. */}
          <Text style={[typography.bodyMedium, { color: budgetCollisionSet.has(b.packageName) ? colors.danger : lockedInk, flex: 1 }]} numberOfLines={1}>
            {`${b.appLabel} · ${b.limit} ${unit}/day${used !== undefined ? ` · ${used} used` : ''}`}
          </Text>
          {budgetCollisionSet.has(b.packageName) && (
            <View
              style={styles.collisionBadge}
              accessibilityRole="text"
              accessibilityLabel={`Blocked: ${b.appLabel} is fully blocked`}
            >
              <Text style={[typography.label, { color: colors.danger }]}>
                Blocked
              </Text>
            </View>
          )}
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
            <Text style={[typography.caption, { color: colors.danger }]}>
              DELETE
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.compactStepperRow}>
          <View style={styles.stepperGroup}>
            <TouchableOpacity style={[styles.compactStepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => handleUpdateBudget(b.id, { limit: b.limit - 1 })} accessibilityRole="button" accessibilityLabel="Lower limit">
              <Text style={[styles.compactStepperText, { color: lockedInk }]}>−</Text>
            </TouchableOpacity>
            <Text style={[styles.compactStepperValue, { color: lockedInk }]}>{b.limit}</Text>
            <TouchableOpacity style={[styles.compactStepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => handleUpdateBudget(b.id, { limit: b.limit + 1 })} accessibilityRole="button" accessibilityLabel="Raise limit">
              <Text style={[styles.compactStepperText, { color: lockedInk }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

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

          <Text style={[typography.displaySmall, { color: lockedInk, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            INSTALLED APPS
          </Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => { tap(); setAppPickerOpen(true); }}
            disabled={dumb}
            style={[styles.input, styles.appPickerField, { backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}
            accessibilityRole="button"
            accessibilityLabel="Choose apps to block"
          >
            <Text
              style={[typography.body, { color: selectedApps.length > 0 ? lockedInk : muted, flex: 1, flexShrink: 1 }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {selectedApps.length > 0
                ? selectedApps.map(a => a.appName).join(', ')
                : 'Search apps...'}
            </Text>
          </TouchableOpacity>
          {selectedApps.length > 0 && (
            <View pointerEvents={dumb ? 'none' : 'auto'} style={[styles.chipRow, dumb && styles.grayed]}>
              {selectedApps.map(a => (
                <TouchableOpacity
                  key={a.packageName}
                  activeOpacity={0.7}
                  onPress={() => handlePickApp(a)}
                  style={[styles.chip, { borderColor: border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${a.appName}`}
                >
                  <Text style={[typography.caption, { color: lockedInk, flexShrink: 1 }]} numberOfLines={1} ellipsizeMode="tail">
                    {a.appName}
                  </Text>
                  <Text style={[typography.caption, { color: muted }]}>
                    ×
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <Modal
            visible={appPickerOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setAppPickerOpen(false)}
          >
            <TouchableWithoutFeedback onPress={() => { setAppPickerOpen(false); Keyboard.dismiss(); }}>
              <View style={[styles.pickerBackdrop, { backgroundColor: isDark ? darkColors.overlay : colors.overlay }]}>
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
                    {filteredApps.length === 0 || !appsLoaded ? (
                      <View style={styles.noAppsFound}>
                        {appsLoaded && (
                          <Image source={mascotSource('thinking', isDark)} style={styles.noAppsImage} resizeMode="contain" />
                        )}
                        <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkMuted, paddingVertical: spacing.md, textAlign: 'center' }]}>
                          {appsLoaded ? 'No apps found' : 'Loading apps…'}
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
                                      ? darkColors.ink + '0F'
                                      : colors.ectoGreen + '14'
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

          <SectionRow
            open={showManualPkg}
            title="MANUAL SETUP"
            summary={manualSummary}
            ink={lockedInk}
            muted={muted}
            onPress={() => { tap(); setShowManualPkg(v => !v); }}
            label="Manual package override"
          />
          {showManualPkg && (
            <>
              <Text style={[typography.caption, { color: muted, marginBottom: spacing.sm }]}>
                Only needed if your app is not in the list above.
              </Text>
              <TextInput
                style={[styles.input, { color: lockedInk, backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}
                placeholder="e.g., com.instagram.android"
                placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
                value={packageName}
                editable={!dumb}
                onChangeText={(text) => { setPackageName(text); setAppName(''); setSelectedApps([]); }}
              />
            </>
          )}
          <Text style={[typography.displaySmall, { color: muted, marginTop: spacing.xl, textAlign: 'center' }]}>
            PRO FEATURES
          </Text>
          <Text style={[typography.displaySmall, { color: ink, marginTop: spacing.xl, marginBottom: spacing.xs }]}>
            DUMBPHONE MODE
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleDumbphone}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: dumb }}
              accessibilityLabel="Enable Dumbphone Mode"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  Dumbphone Mode
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Strict blocking, nothing counts. Locks the rest of this task's setup, except allowed apps.
                </Text>
              </View>
              <View style={[styles.toggleTrack, { borderColor: border }, dumb && styles.toggleTrackOn]}>
                <View style={[styles.toggleKnob, dumb && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            {/* Allowed apps nest inside Dumbphone Mode — active only when dumb is on (and Pro). */}
            <View style={[styles.nestedDivider, { borderColor: muted }]} />
            <View pointerEvents={dumb ? 'auto' : 'none'} style={[!dumb && styles.grayed]}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleToggleAllowlist}
                style={styles.scheduleToggleRow}
                accessibilityRole="switch"
                accessibilityState={{ checked: allowlistMode }}
                accessibilityLabel="Enable allowlist mode"
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
                  <View style={styles.presetBtnText}>
                    <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1} ellipsizeMode="tail">
                      {allowlistPkgs.length > 0 ? `${allowlistPkgs.length} app${allowlistPkgs.length === 1 ? '' : 's'} allowed` : 'Choose allowed apps…'}
                    </Text>
                    <Text style={[typography.caption, { color: muted, marginTop: 2 }]} numberOfLines={1} ellipsizeMode="tail">
                      {allowlistPkgs.length > 0 ? allowlistPkgs.map(appLabelFor).join(', ') : 'No apps chosen yet'}
                    </Text>
                  </View>
                </TouchableOpacity>
                {allowlistMode && allowlistPkgs.length === 0 && (
                  <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
                    Empty = all blocked but phone & StayT
                  </Text>
                )}
              </View>
            </View>
          </View>
          <Text style={[typography.displaySmall, { color: lockedInk, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            STRICT MODE
          </Text>
          <View pointerEvents={dumb ? 'none' : 'auto'} style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleStrict}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: strict }}
              accessibilityLabel="Enable strict mode"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[typography.bodyMedium, { color: lockedInk }]}>
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
          <SectionRow
            open={showSchedule}
            title="AUTO-BLOCK SCHEDULE"
            summary={scheduleSummary}
            ink={lockedInk}
            muted={muted}
            onPress={() => { tap(); setShowSchedule(v => !v); }}
            label="Auto-block schedule"
          />
          {scheduleHint && !showSchedule && (
            <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.sm }]}>
              {scheduleHint}
            </Text>
          )}
          {showSchedule && (
          <>
          <Text style={[typography.caption, { color: muted, marginBottom: spacing.sm }]}>
            Blocks this task's apps at set times, even when no session is running.
          </Text>
          <View pointerEvents={dumb ? 'none' : 'auto'} style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleSchedule}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: scheduleEnabled }}
              accessibilityLabel="Enable schedule"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[typography.bodyMedium, { color: lockedInk }]}>
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
            <Text style={[typography.label, { color: muted, marginTop: spacing.md, marginBottom: spacing.sm }]}>
              PRESETS
            </Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => applySchedulePreset('work')}
              disabled={presetBusy}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Apply work hours preset 9 AM to 5 PM weekdays"
            >
              <View style={styles.presetBtnText}>
                <Text style={[typography.bodyMedium, { color: lockedInk }]}>
                  Work hours
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Weekdays · 09:00–17:00
                </Text>
              </View>
              <ChevronRightIcon size={20} color={muted} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => applySchedulePreset('bedtime')}
              disabled={presetBusy}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Apply bedtime preset 11 PM to 7 AM"
            >
              <View style={styles.presetBtnText}>
                <Text style={[typography.bodyMedium, { color: lockedInk }]}>
                  Bedtime
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Daily · 23:00–07:00
                </Text>
              </View>
              <ChevronRightIcon size={20} color={muted} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={applySprintPreset}
              disabled={presetBusy}
              style={[styles.presetBtn, { borderColor: border }]}
              accessibilityRole="button"
              accessibilityLabel="Start a one-shot 25 minute block from now"
            >
              <View style={styles.presetBtnText}>
                <Text style={[typography.bodyMedium, { color: lockedInk }]}>
                  Focus sprint
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Once · 25 min from now
                </Text>
              </View>
              <ChevronRightIcon size={20} color={muted} />
            </TouchableOpacity>
            {presetNote && (
              <Text style={[typography.caption, { color: muted, marginTop: spacing.sm, marginBottom: spacing.md }]}>
                {presetNote}
              </Text>
            )}
            {/* A one-time sprint has no weekdays to pick. */}
            {!onceWindow && (
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
                        <Text style={[styles.dayChipText, { color: on ? colors.midnight : lockedInk }]}>
                          {DAY_LABELS[i]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
            )}
                <View style={styles.timeRow}>
                  <Text style={[typography.label, { color: lockedInk }]}>START</Text>
                  <View style={styles.stepperGroup}>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('start', -1)} accessibilityRole="button" accessibilityLabel="Decrease start hour">
                      <Text style={[styles.stepperText, { color: lockedInk }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.timeText, { color: lockedInk }]}>{formatScheduleTime(startMinutes)}</Text>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('start', 1)} accessibilityRole="button" accessibilityLabel="Increase start hour">
                      <Text style={[styles.stepperText, { color: lockedInk }]}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.minuteBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => cycleMinute('start')} accessibilityRole="button" accessibilityLabel="Cycle start minutes">
                      <Text style={[styles.minuteText, { color: lockedInk }]}>:{String(startMinutes % 60).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.timeRow}>
                  <Text style={[typography.label, { color: lockedInk }]}>END</Text>
                  <View style={styles.stepperGroup}>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('end', -1)} accessibilityRole="button" accessibilityLabel="Decrease end hour">
                      <Text style={[styles.stepperText, { color: lockedInk }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.timeText, { color: lockedInk }]}>{formatScheduleTime(endMinutes)}</Text>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('end', 1)} accessibilityRole="button" accessibilityLabel="Increase end hour">
                      <Text style={[styles.stepperText, { color: lockedInk }]}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.minuteBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => cycleMinute('end')} accessibilityRole="button" accessibilityLabel="Cycle end minutes">
                      <Text style={[styles.minuteText, { color: lockedInk }]}>:{String(endMinutes % 60).padStart(2, '0')}</Text>
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
          </>
          )}
          <SectionRow
            open={showBudgets}
            title="APP BUDGETS · FOR THIS TASK"
            summary={budgetSummary}
            ink={lockedInk}
            muted={muted}
            onPress={() => { tap(); setShowBudgets(v => !v); }}
            label="App budgets for this task"
          />
          {budgetCollisions.length > 0 && (
            <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.sm }]}>
              {`${budgetCollisions.map(appLabelFor).join(', ')} ${budgetCollisions.length === 1 ? 'is' : 'are'} already blocked in this task, so ${budgetCollisions.length === 1 ? 'its budget has' : 'their budgets have'} no effect here.`}
            </Text>
          )}
          {showBudgets && (
          <>
          <Text style={[typography.caption, { color: muted, marginBottom: spacing.sm }]}>
            Metered per app for this task. Enforcement is still global while any session runs.
          </Text>
          <View pointerEvents={dumb ? 'none' : 'auto'} style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}>
            {taskBudgets.length === 0 ? (
              <Text style={[typography.caption, { color: muted }]}>
                No budgets for this task yet.
              </Text>
            ) : (
              taskBudgets.map(renderBudgetRow)
            )}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => { tap(); setBudgetPickerOpen(true); }}
              style={[styles.input, styles.appPickerField, { backgroundColor: cardBg, borderColor: border, marginTop: spacing.md }]}
              accessibilityRole="button"
              accessibilityLabel="Choose app to meter"
            >
              <Text
                style={[typography.body, { color: newBudgetPkg ? lockedInk : muted, flex: 1 }]}
                numberOfLines={1}
              >
                {newBudgetPkg ? appLabelFor(newBudgetPkg) : 'Choose app…'}
              </Text>
            </TouchableOpacity>
            <View style={styles.compactSegRow}>
              {(['opens', 'minutes'] as const).map(k => {
                const on = newBudgetKind === k;
                return (
                  <TouchableOpacity
                    key={k}
                    activeOpacity={0.7}
                    onPress={() => { tap(); setNewBudgetKind(k); }}
                    style={[styles.compactSegBtn, { borderColor: border }, on && styles.compactSegBtnOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Budget meter ${k}`}
                  >
                    <Text style={[styles.compactSegText, { color: on ? colors.midnight : lockedInk }]}>
                      {k === 'opens' ? 'OPENS' : 'MIN'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.compactStepperRow}>
              <Text style={[typography.label, { color: lockedInk }]}>LIMIT</Text>
              <View style={styles.stepperGroup}>
                <TouchableOpacity style={[styles.compactStepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => { tap(); setNewBudgetLimit(v => Math.max(1, v - 1)); }} accessibilityRole="button" accessibilityLabel="Lower new budget limit">
                  <Text style={[styles.compactStepperText, { color: lockedInk }]}>−</Text>
                </TouchableOpacity>
                <Text style={[styles.compactStepperValue, { color: lockedInk }]}>{newBudgetLimit}</Text>
                <TouchableOpacity style={[styles.compactStepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => { tap(); setNewBudgetLimit(v => Math.min(999, v + 1)); }} accessibilityRole="button" accessibilityLabel="Raise new budget limit">
                  <Text style={[styles.compactStepperText, { color: lockedInk }]}>+</Text>
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
              <Text style={[typography.bodyMedium, { color: lockedInk, textAlign: 'center' }]}>
                ADD BUDGET
              </Text>
            </TouchableOpacity>
          </View>
          </>
          )}
          <SectionRow
            open={showDomains}
            title="WEBSITES"
            summary={domainsSummary}
            ink={lockedInk}
            muted={muted}
            onPress={() => { tap(); setShowDomains(v => !v); }}
            label="Blocked websites"
          />
          {domainError && !showDomains && (
            <Text style={[typography.caption, { color: colors.danger, marginBottom: spacing.sm }]}>
              {domainError}
            </Text>
          )}
          {showDomains && (
          <>
          <View pointerEvents={dumb ? 'none' : 'auto'} style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}>
            {domains.length === 0 ? (
              <Text style={[typography.caption, { color: muted }]}>
                No blocked sites yet.
              </Text>
            ) : domains.map(d => (
              <View key={d.id} style={styles.rowBetween}>
                <View style={styles.rowMain}>
                  <Text style={[typography.bodyMedium, { color: lockedInk }]} numberOfLines={1}>
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
              style={[styles.input, { color: lockedInk, backgroundColor: cardBg, borderColor: border, marginTop: spacing.md }]}
              placeholder="example.com"
              placeholderTextColor={muted}
              value={newDomain}
              editable={!dumb}
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
              <Text style={[typography.bodyMedium, { color: lockedInk, textAlign: 'center' }]}>
                ADD WEBSITE
              </Text>
            </TouchableOpacity>
          </View>
          </>
          )}
          <SectionRow
            open={showFeeds}
            title="FEED SHIELD"
            summary={feedSummary}
            ink={lockedInk}
            muted={muted}
            onPress={() => { tap(); setShowFeeds(v => !v); }}
            label="Feed Shield"
          />
          {feedCollisions.length > 0 && !showFeeds && (
            <Text style={[typography.caption, { color: muted, marginBottom: spacing.sm }]}>
              {`${feedCollisions.map(appLabelFor).join(', ')} ${feedCollisions.length === 1 ? 'is' : 'are'} blocked in this task, so Feed Shield has no effect here.`}
            </Text>
          )}
          {showFeeds && (
          <>
          <View pointerEvents={dumb ? 'none' : 'auto'} style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }, dumb && styles.grayed]}>
            <Text style={[typography.caption, { color: muted }]}>
              Backs you out of feeds like Reels without blocking the whole app. Turn it off if an app acts up.
            </Text>
            {feedCollisions.length > 0 && (
              <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                {`${feedCollisions.map(appLabelFor).join(', ')} ${feedCollisions.length === 1 ? 'is' : 'are'} blocked in this task, so Feed Shield has no effect here.`}
              </Text>
            )}
            {feedFilters.length === 0 ? (
              <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                No apps shielded yet.
              </Text>
            ) : feedFilters.map(f => (
              <View key={f.packageName} style={styles.budgetRow}>
                <View style={styles.rowBetween}>
                  <View style={styles.rowMain}>
                      <Text style={[typography.bodyMedium, { color: lockedInk }]} numberOfLines={1}>
                        {appLabelFor(f.packageName)}
                    </Text>
                    <Text style={[typography.caption, { color: muted, marginTop: 2 }]} numberOfLines={1}>
                      {f.packageName}
                    </Text>
                    {feedCollisionSet.has(f.packageName) && (
                      <View
                        style={[styles.collisionBadge, { alignSelf: 'flex-start', marginLeft: 0, marginTop: spacing.xs }]}
                        accessibilityRole="text"
                        accessibilityLabel={`Blocked: ${appLabelFor(f.packageName)} is fully blocked`}
                      >
                        <Text style={[typography.label, { color: colors.danger }]}>
                          Blocked
                        </Text>
                      </View>
                    )}
                  </View>
                  <RowSwitch
                    on={f.enabled}
                    onPress={() => handleToggleFeedFlag(f.packageName, 'enabled')}
                    border={border}
                    label={`Feed Shield for ${f.packageName} ${f.enabled ? 'enabled' : 'disabled'}`}
                  />
                </View>
                {([['hideReels', 'Reels'], ['hideExplore', 'Explore'], ['hideComments', 'Comments']] as const).map(([flag, label]) => (
                  <View key={flag} style={styles.rowBetween}>
                    <Text style={[typography.body, { color: lockedInk }]}>
                      {label}
                    </Text>
                    <RowSwitch
                      on={f[flag]}
                      onPress={() => handleToggleFeedFlag(f.packageName, flag)}
                      border={border}
                      label={`${label} filter for ${f.packageName}`}
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
              <Text style={[typography.bodyMedium, { color: lockedInk, textAlign: 'center' }]}>
                ADD APP
              </Text>
            </TouchableOpacity>
          </View>
          </>
          )}
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
            loading={!appsLoaded}
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
            loading={!appsLoaded}
          />
          {/* Q2: budget creation reuses the same picker — single-pick and close. */}
          <AppSelectModal
            visible={budgetPickerOpen}
            onClose={() => setBudgetPickerOpen(false)}
            onPick={(app) => { tap(); setNewBudgetPkg(app.packageName); setBudgetPickerOpen(false); }}
            apps={installedApps}
            picked={newBudgetPkg ? [newBudgetPkg] : []}
            cardBg={cardBg}
            border={border}
            ink={ink}
            muted={muted}
            placeholder="Search app to meter..."
            loading={!appsLoaded}
          />
        </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: canSave ? 1 : 0.5 }]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!canSave}
          onPressIn={canSave ? handlePressIn : undefined}
          onPressOut={canSave ? handlePressOut : undefined}
        >
          <Text style={styles.primaryButtonText}>SAVE TASK</Text>
        </AnimatedTouchable>
        {!canSave && saveHint && (
          <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
            {saveHint}
          </Text>
        )}
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
    backgroundColor: colors.overlay,
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
    backgroundColor: colors.inkFaint,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    minHeight: 44,
  },
  presetBtnText: {
    flex: 1,
    flexShrink: 1,
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
  // Hairline separating the nested allowlist from the dumbphone toggle above.
  nestedDivider: {
    borderTopWidth: 1,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  deleteTextBtn: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionRowText: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 2,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    maxWidth: '100%',
    flexShrink: 1,
  },
  collisionBadge: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    marginLeft: spacing.sm,
    alignSelf: 'center',
  },
  compactSegRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  compactSegBtn: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  compactSegBtnOn: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  compactSegText: {
    ...typography.label,
  },
  compactStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    minHeight: 40,
  },
  compactStepperBtn: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  compactStepperText: {
    ...typography.bodyMedium,
  },
  compactStepperValue: {
    ...typography.bodyMedium,
    minWidth: 44,
    textAlign: 'center',
  },
});
