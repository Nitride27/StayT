import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, useWindowDimensions, Platform, ActivityIndicator } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Session, Task, UserPreferences, blockedPackagesOf, isEffectiveStrict } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { SwitchArrowsIcon } from '../components/icons';
import AppBlocker from '../native/AppBlocker';
import { syncWidgetNow } from '../widget/widgetSync';
import { ensureDailyReminder, cancelDailyReminder } from '../notifications/reminders';
import { tap } from '../haptics';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveSession'>;
  // Params are always supplied at entry (TaskPicker resets with them), but a
  // process death / restore can recreate this screen without them — read
  // defensively and re-hydrate from the store on focus (see below).
  route: { params?: { task: Task; session: Session } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

type SessionOpts = {
  friction: { enabled: boolean; delaySeconds: number; escalate: boolean };
  allowlist: string[] | null;
};

// Single opts builder for the mount apply and the 5s re-apply: both paths
// push identical config. Friction prefs absent = disabled; allowlist [] for
// non-Pro = null ([] never crosses for free).
function buildSessionOpts(prefs: UserPreferences, task: Task): SessionOpts {
  const isPro = prefs.isSubscribed === true;
  return {
    friction: {
      enabled: prefs.frictionEnabled === true,
      delaySeconds: prefs.frictionDelaySeconds ?? 10,
      escalate: isPro,
    },
    allowlist: task.allowlistMode === true && isPro ? (task.allowlist ?? []) : null,
  };
}

// Push friction + task-scoped budgets/domains/filters, all best-effort. Prefs
// are read fresh on every call — never cached across re-applies. Budgets are
// task-only: only the ACTIVE task's tagged rows are pushed (untagged legacy
// rows are inert — never pushed, never enforced).
async function pushSessionConfig(task: Task): Promise<SessionOpts> {
  const fallback: SessionOpts = {
    friction: { enabled: false, delaySeconds: 10, escalate: false },
    allowlist: null,
  };
  try {
    const prefs = await store.getPreferences();
    const opts = buildSessionOpts(prefs, task);
    await AppBlocker.setFriction(opts.friction).catch(() => {});
    const [budgets, domains, filters] = await Promise.all([
      store.getBudgetsForTask(task.id),
      store.getBlockedDomains(),
      store.getFeedFilters(),
    ]);
    await AppBlocker.setBudgets(budgets.filter(b => b.enabled === true)).catch(() => {});
    await AppBlocker.setBlockedDomains(
      domains.filter(d => d.enabled !== false).map(d => d.domain),
    ).catch(() => {});
    await AppBlocker.setFeedFilters(filters).catch(() => {});
    return opts;
  } catch {
    return fallback;
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Wave 2C2: brand line for the blocking-off banner. Local duplicate of the
// PermissionSetup OEM logic (do not import across screens).
function getSessionOEMTip(): string | null {
  if (Platform.OS !== 'android') return null;
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer =
    (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  const hay = `${manufacturer} ${model}`;
  if (hay.includes('xiaomi') || hay.includes('redmi') || hay.includes('poco'))
    return 'Xiaomi: Settings > Apps > StayT > Autostart ON, Battery > No restrictions.';
  if (hay.includes('samsung'))
    return 'Samsung: add StayT to Never-sleeping apps, Battery > Unrestricted.';
  if (hay.includes('huawei') || hay.includes('honor'))
    return 'Huawei: App launch > StayT > Manage manually, all toggles ON.';
  if (hay.includes('oppo') || hay.includes('realme'))
    return 'OPPO: Autostart ON, App battery management > No restrictions.';
  if (hay.includes('oneplus'))
    return 'OnePlus: Autostart ON, Battery optimization > Don\u2019t optimize.';
  if (hay.includes('vivo') || hay.includes('iqoo'))
    return 'Vivo: Autostart ON, Background power consumption > Allow.';
  if (hay.includes('motorola') || hay.includes('moto'))
    return 'Motorola: Adaptive Battery > exclude StayT, Battery > Unrestricted.';
  if (hay.includes('nothing'))
    return 'Nothing: Autostart ON, Battery > Unrestricted.';
  return null;
}

export default function ActiveSessionScreen({ navigation, route }: Props) {
  // Entry snapshot: TaskPicker.reset supplies these, but they go stale the
  // moment the app is backgrounded (task edited, session superseded) or the
  // process dies. They are the fallback — the store is the source of truth
  // after the focus hydration below runs.
  const routeTask = route.params?.task ?? null;
  const routeSession = route.params?.session ?? null;
  const { isDark } = useTheme();
  const [task, setTask] = useState<Task | null>(routeTask);
  const [session, setSession] = useState<Session | null>(routeSession);
  // Hydration gate: nothing below renders until the store has been consulted
  // at least once — the screen is loading, live, or ended. Never half-drawn.
  const [hydrated, setHydrated] = useState(false);
  const [elapsed, setElapsed] = useState(routeSession?.startedAt ? Date.now() - routeSession.startedAt : 0);
  // False when the service is off or startBlocking fails — blocking silently
  // doing nothing is the worst outcome, so the banner below says so loudly.
  const [blockingOk, setBlockingOk] = useState(true);
  const blockingOkRef = React.useRef(true);
  // Dumfound forces the strict session UI (same lock as Task.strict).
  const [dumfound, setDumfound] = useState(false);
  const effectiveStrict = isEffectiveStrict(task?.strict, dumfound);
  // Dynamic to screen size: fixed 220px mascots push the buttons off small screens.
  const { height: winH } = useWindowDimensions();
  const mascotSize = Math.min(220, Math.max(120, Math.floor(winH * 0.24)));

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const timerOpacity = useSharedValue(0);
  const timerScale = useSharedValue(0.9);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    timerOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    timerScale.value = withDelay(250, withSpring(1, { damping: 16, stiffness: 200 }));

    buttonOpacity.value = withDelay(550, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  // Re-hydrate from the store on every focus: returning mid-session (back
  // from the interstitial, app backgrounded, process restarted) re-reads the
  // live session + task instead of trusting the entry snapshot. When the
  // store has no active session the snapshot is kept — the screen never
  // blanks to a half state. Single async body, live-guarded, no timer here.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        try {
          const active = await store.getActiveSession();
          if (!live) return;
          if (active) {
            const tasks = await store.getTasks();
            if (!live) return;
            const fresh = tasks.find(t => t.id === active.taskId) ?? null;
            if (fresh) setTask(fresh);
            setSession(active);
            // Task-based Dumbphone Mode (not the deprecated global pref).
            setDumfound(fresh?.dumbphoneMode === true);
          }
        } catch {
          // Best-effort: the entry snapshot stays on screen.
        } finally {
          if (live) setHydrated(true);
        }
      })();
      return () => {
        live = false;
      };
    }, []),
  );

  // Timer tick — keyed on the live startedAt (not the entry snapshot).
  // Single interval per startedAt value, always cleared, so
  // background/return cycles can never stack ticks.
  const startedAt = session?.startedAt ?? 0;
  useEffect(() => {
    if (!startedAt) return;
    setElapsed(Date.now() - startedAt);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  // Start blocking when session begins; always release on unmount
  // so a gesture-back can't leave blocking on with no session.
  // Verifies the service is actually up: without it there is no blocking
  // and no blocked screen, so show the banner instead of failing silently.
  // Polls every 5s — the OS/OEM can kill the service mid-session.
  //
  // Keyed on the hydrated task/session ids plus the effective block set (not
  // object identity — focus re-hydration allocates fresh objects): pushes once
  // per session and re-pushes when the underlying task content actually
  // changed (edited block list / allowlist while this session is live — the
  // old id-only key kept enforcing the stale list). The poll + unmount
  // cleanup are owned by this one effect, so exactly one poll ever runs.
  const blockingKey = `${task?.id ?? ''}:${session?.id ?? ''}:${task ? blockedPackagesOf(task).join(',') : ''}:${task?.allowlistMode === true ? (task.allowlist ?? []).join(',') : ''}`;
  useEffect(() => {
    if (!hydrated || !task || !session) return;
    // Narrowed copies for the async closures below (narrowing does not
    // survive into callbacks).
    const liveTask = task;
    const liveSession = session;
    let live = true;
    const mark = (ok: boolean) => {
      blockingOkRef.current = ok;
      if (live) setBlockingOk(ok);
    };
    (async () => {
      const enabled = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
      if (!live) return;
      if (!enabled) {
        mark(false);
        return;
      }
      const { allowlist } = await pushSessionConfig(liveTask);
      if (!live) return;
      const ok = await AppBlocker.startBlocking(blockedPackagesOf(liveTask), liveTask.name, { allowlist }).catch(() => false);
      mark(ok !== false);
    })();
    // P2-1: push today's totals + last-task packages to the widget mirror.
    syncWidgetNow(liveTask).catch(() => {});
    // A daily nudge scheduled while the app was killed could fire mid-session
    // — cancel it on mount; handleEndSession re-pairs it on the way out.
    cancelDailyReminder().catch(() => {});
    const poll = setInterval(async () => {
      const enabled = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
      if (!live) return;
      if (!enabled) {
        mark(false);
        return;
      }
      // Service (back) on: (re-)apply the allow-list — the native list is
      // in-memory so a kill/re-enable loses it. Only call when we were
      // previously down to avoid re-pushing every 5s.
      if (!blockingOkRef.current) {
        const { allowlist } = await pushSessionConfig(liveTask);
        if (!live) return;
        const ok = await AppBlocker.startBlocking(blockedPackagesOf(liveTask), liveTask.name, { allowlist }).catch(() => false);
        mark(ok !== false);
      }
    }, 5000);
    return () => {
      live = false;
      clearInterval(poll);
      AppBlocker.stopBlocking().catch(() => {});
    };
  }, [hydrated, blockingKey]);

  const finishSession = async () => {
    const s = session;
    try {
      if (s) {
        await store.saveSession({ ...s, status: 'completed', endedAt: Date.now(), duration: Date.now() - s.startedAt });
      }
    } finally {
      // Blocking must release even if the save failed — never trap the user.
      await AppBlocker.stopBlocking().catch(() => {});
    }
    // Slow cosmetics refresh in the background: neither TaskPicker nor
    // History reads them on mount, so never hold the transition for them.
    // (P2-1 widget mirror + N-2 daily nudge re-pair.)
    syncWidgetNow(task).catch(() => {});
    ensureDailyReminder().catch(() => {});
  };

  // SWITCH TASK ends this session and returns to the picker to start another.
  // replace (not navigate): the session screen must not stay buried in the
  // stack — a later start would push a duplicate over it and a system BACK
  // could resurrect this now-dead instance (stale task, dead blocking).
  const handleSwitchTask = async () => {
    tap();
    await finishSession();
    navigation.replace('TaskPicker');
  };

  // END SESSION ends this session and shows it logged in History.
  // replace (not navigate): History's back button must land on TaskPicker,
  // not back on this now-dead session screen.
  const handleEndSession = async () => {
    tap('medium');
    await finishSession();
    navigation.replace('History');
  };

  // Wave 2C2 OEM survival (additive, best-effort): false → fall back to
  // the generic accessibility screen. The 5s service poll above is kept.
  const handleOpenOEM = async () => {
    tap();
    try {
      const ok = await AppBlocker.openManufacturerSettings();
      if (!ok) AppBlocker.openAccessibilitySettings();
    } catch {
      try {
        AppBlocker.openAccessibilitySettings();
      } catch {
        // Best-effort.
      }
    }
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const timerAnimStyle = useAnimatedStyle(() => ({
    opacity: timerOpacity.value,
    transform: [{ scale: timerScale.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  // Blur cleanup: leaving mid-entry (interstitial pushed over us) cancels the
  // in-flight entry timings and snaps values to their end state, so returning
  // can never reveal half-mounted reanimated views. Mount effect above owns
  // the forward run; this owns only the blur tail.
  useFocusEffect(
    useCallback(() => {
      return () => {
        cancelAnimation(headerOpacity);
        cancelAnimation(headerTranslateY);
        cancelAnimation(timerOpacity);
        cancelAnimation(timerScale);
        cancelAnimation(buttonOpacity);
        headerOpacity.value = 1;
        headerTranslateY.value = 0;
        timerOpacity.value = 1;
        timerScale.value = 1;
        buttonOpacity.value = 1;
      };
    }, [headerOpacity, headerTranslateY, timerOpacity, timerScale, buttonOpacity]),
  );

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const endBg = isDark ? darkColors.paperCard : colors.midnight;
  const endText = darkColors.ink;
  // Wave 2C2: brand line for the banner below (null on non-matching OEMs).
  const oemTip = getSessionOEMTip();

  // Full-state gates (never a half screen): hydration pending → spinner;
  // hydrated but no task/session (params lost + store empty, e.g. session
  // ended elsewhere while away) → ended card with a way home.
  if (!hydrated) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color={colors.ectoGreen} accessibilityLabel="Loading session" />
      </View>
    );
  }
  if (!task || !session) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: bg }]}>
        <Text style={[typography.display, { color: ink, textAlign: 'center' }]}>
          SESSION ENDED
        </Text>
        <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
          This session is no longer active.
        </Text>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.replace('TaskPicker')}
          style={[styles.endButton, { backgroundColor: endBg, marginTop: spacing.xl, alignSelf: 'stretch' }]}
          accessibilityRole="button"
          accessibilityLabel="Back to tasks"
        >
          <Text style={[typography.cta, { color: endText, textAlign: 'center' }]}>
            BACK TO TASKS
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {!blockingOk && (
        <View style={[styles.blockWarn, { borderColor: ink }]} accessibilityRole="alert">
          <Text style={[typography.bodyStrong, { color: ink, textAlign: 'center' }]}>
            Blocking isn't active
          </Text>
          <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: 4 }]}>
            StayT needs the Accessibility permission or your apps won't be blocked.
          </Text>
          {/* Wave 2C2 brand line (additive, banner otherwise unchanged). */}
          {oemTip && (
            <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: 4 }]}>
              {oemTip}
            </Text>
          )}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => AppBlocker.openAccessibilitySettings()}
            style={styles.blockWarnBtn}
            accessibilityRole="button"
            accessibilityLabel="Re-enable blocking service"
          >
            <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
              RE-ENABLE SERVICE
            </Text>
          </TouchableOpacity>
          {/* Wave 2C2 second button (additive): OEM battery settings. */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={handleOpenOEM}
            style={styles.blockWarnBtn}
            accessibilityRole="button"
            accessibilityLabel="Open manufacturer battery settings"
          >
            <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
              OPEN OEM SETTINGS
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <Image source={mascotSource('working', isDark)} style={[styles.mascotImage, { width: mascotSize, height: mascotSize }]} resizeMode="contain" />
        <Text style={[typography.display, { color: ink, textAlign: 'center', marginTop: spacing.lg }]}>
          {task.name.toUpperCase()}
        </Text>
        {effectiveStrict && (
          <View style={styles.strictBadge} accessibilityRole="text" accessibilityLabel="Strict mode on">
            <Text style={[typography.label, { color: colors.midnight }]}>STRICT</Text>
          </View>
        )}
      </Animated.View>

      <Animated.View style={[styles.timerArea, timerAnimStyle]}>
        <Text style={[typography.timerXL, { color: ink }]}>
          {formatElapsed(elapsed)}
        </Text>
        <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
          Small steps build big progress.
        </Text>
      </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={styles.switchButton}
          activeOpacity={0.85}
          onPress={handleSwitchTask}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <View style={styles.switchRow}>
            <SwitchArrowsIcon size={18} color={colors.midnight} />
            <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>SWITCH TASK</Text>
          </View>
        </AnimatedTouchable>
        <TouchableOpacity activeOpacity={0.7} onPress={handleEndSession} style={[styles.endButton, { backgroundColor: endBg }]}>
          <Text style={[typography.cta, { color: endText, textAlign: 'center' }]}>
            END SESSION
          </Text>
        </TouchableOpacity>
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
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  blockWarn: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  blockWarnBtn: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  mascotImage: {
    width: 220,
    height: 220,
  },
  strictBadge: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 2,
    borderBottomColor: colors.ectoGreenDark,
  },
  timerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButton: {
    borderBottomWidth: 3,
    borderBottomColor: darkColors.paper,
    borderRadius: radius.xl,
    paddingVertical: 18,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  bottomSection: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  switchButton: {
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
