import React, { useState, useEffect } from 'react';
import { StatusBar, View, ActivityIndicator, Linking } from 'react-native';
import { NavigationContainer, useNavigationContainerRef, StackActions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import WelcomeScreen from './src/screens/WelcomeScreen';
import TaskPickerScreen from './src/screens/TaskPickerScreen';
import TaskSetupScreen from './src/screens/TaskSetupScreen';
import ActiveSessionScreen from './src/screens/ActiveSessionScreen';
import BlockedInterstitialScreen from './src/screens/BlockedInterstitialScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SessionDetailScreen from './src/screens/SessionDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PrivacyPolicyScreen from './src/screens/PrivacyPolicyScreen';
import PermissionSetupScreen from './src/screens/PermissionSetupScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { store } from './src/storage/store';
import { Task, Session } from './src/types';
import AppBlocker from './src/native/AppBlocker';
import { decideEntry, shouldLogEntry } from './src/navigation/blockedEntry';
import { isSelfTestRunning } from './src/blocktest/useBlockSelfTest';
import {
  ensureReminderHandler,
  setupReminderGuard,
  ensureDailyReminder,
} from './src/notifications/reminders';
import { colors, darkColors } from './src/theme/tokens';
import { initAds } from './src/ads/ads';

SplashScreen.preventAutoHideAsync();

export type RootStackParamList = {
  Welcome: undefined;
  PermissionSetup: { pendingTaskId?: string } | undefined;
  Paywall: undefined;
  TaskPicker: { autoStartTaskId?: string } | undefined;
  TaskSetup: { task?: Task };
  ActiveSession: { task: Task; session: Session };
  BlockedInterstitial: { packageName: string; taskId: string; appLabel?: string };
  History: undefined;
  SessionDetail: { sessionId: string };
  Settings: undefined;
  PrivacyPolicy: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// M1: collision-proof record IDs — two blocks in the same millisecond must
// never share an ID.
function newBlockedId(): string {
  return `blocked-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Session-survival bound: a boot-time `active` session younger than this is
// treated as a live session the user never stopped (process kill, OS
// reclaim) and is resumed, not closed. Older than this is a dead remnant and
// is completed so History never renders phantom rows. Focus sessions run
// minutes-to-hours; 12h is comfortably beyond any legitimate one.
const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

// A block belongs to the RUNNING session's task. An app can sit in several
// tasks (and allowlist mode blocks apps no task lists), so "first task that
// lists the package" mislabelled blocks — wrong task name on the
// interstitial, and that task's strict/dumbphone rules and taskId applied.
// Falls back to the first listing task only when no session is live
// (e.g. a schedule-only block).
async function taskForBlock(pkg: string): Promise<Task | undefined> {
  const [tasks, active] = await Promise.all([
    store.getTasks().catch(() => [] as Task[]),
    store.getActiveSession().catch(() => null),
  ]);
  const live = active ? tasks.find(t => t.id === active.taskId) : undefined;
  return live ?? tasks.find(t => t.packageName === pkg || t.blockedPackages?.includes(pkg));
}

function AppNavigator() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('Welcome');
  // Boot-resume target for a live session that survived a process death
  // (feeds ActiveSession/PermissionSetup initialParams below).
  const [resumeParams, setResumeParams] = useState<{ task: Task; session: Session } | null>(null);
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  // Blocked entry runs through the BlockedEntryCoordinator seam
  // (src/navigation/blockedEntry.ts): sync claim + route check combined,
  // so near-simultaneous emit + deep-link fires for one block can never
  // double-push, while genuinely new blocks always pass.
  const claimBlockedNav = (packageName: string): boolean => {
    if (!navigationRef.isReady()) return false;
    const r = navigationRef.getCurrentRoute();
    return (
      decideEntry(packageName, {
        ready: true,
        routeName: r?.name,
        routePkg: (r?.params as { packageName?: string } | undefined)?.packageName,
      }) === 'shown'
    );
  };

  // Idempotent interstitial routing (no navigate-push stacking): already on
  // this package's interstitial -> no-op; on another package's interstitial
  // -> replace (BACK must land on the live session, not a stale
  // interstitial); anywhere else -> push once. Duplicate pushes were the
  // "returning shows only parts of the session screen" path — BACK landed on
  // a stale interstitial instead of the session underneath.
  const showBlockedInterstitial = (packageName: string, taskId: string, appLabel: string): void => {
    if (!navigationRef.isReady()) return;
    const r = navigationRef.getCurrentRoute();
    const routePkg = (r?.params as { packageName?: string } | undefined)?.packageName;
    if (r?.name === 'BlockedInterstitial') {
      if (routePkg === packageName) return;
      navigationRef.dispatch(StackActions.replace('BlockedInterstitial', { packageName, taskId, appLabel }));
      return;
    }
    navigationRef.navigate('BlockedInterstitial', { packageName, taskId, appLabel });
  };

  const [fontsLoaded, fontError] = useFonts({
    Anton: require('./assets/fonts/Anton-Regular.ttf'),
    'SpaceGrotesk-Regular': require('./assets/fonts/SpaceGrotesk-Regular.ttf'),
    'SpaceGrotesk-Medium': require('./assets/fonts/SpaceGrotesk-Medium.ttf'),
    'SpaceGrotesk-SemiBold': require('./assets/fonts/SpaceGrotesk-SemiBold.ttf'),
    'SpaceGrotesk-Bold': require('./assets/fonts/SpaceGrotesk-Bold.ttf'),
    'Inter-Regular': require('./assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('./assets/fonts/Inter-Bold.ttf'),
  });

  useEffect(() => {
    (async () => {
      try {
        const prefs = await store.getPreferences();

        // Reconcile zombie sessions left `active` by a process kill — but
        // ONLY stale ones. A fresh active means the session never ended (the
        // user never pressed END/SWITCH): closing it here would silently end
        // a live session on every OS reclaim. Fresh actives are kept and the
        // boot below resumes straight into them (process-death restore).
        let resume: { task: Task; session: Session } | null = null;
        try {
          const sessions = await store.getSessions();
          const now = Date.now();
          for (const s of sessions) {
            if (s.status === 'active' && now - s.startedAt > STALE_SESSION_MS) {
              const duration = Math.max(0, now - s.startedAt);
              await store.saveSession({ ...s, status: 'completed', endedAt: now, duration });
            }
          }
          const remaining = await store.getSessions();
          const active = remaining.find(s => s.status === 'active') ?? null;
          if (active) {
            const tasks = await store.getTasks().catch(() => [] as Task[]);
            const t = tasks.find(x => x.id === active.taskId) ?? null;
            // Deleted task = nothing to resume into; the orphan stays for the
            // next explicit start to supersede (existing TaskPicker rule).
            if (t) resume = { task: t, session: active };
          }
        } catch {
          // Best-effort; a failed reconcile must not block boot.
        }
        if (resume) setResumeParams(resume);

        if (!prefs.hasOnboarded) {
          setInitialRoute('Welcome');
        } else {
          const accessGranted = await AppBlocker.isAccessibilityServiceEnabled();
          if (!accessGranted) {
            setInitialRoute('PermissionSetup');
          } else if (resume) {
            // Process-death restore: land on the live session intact — the
            // screen hydrates from the store and re-pushes blocking.
            setInitialRoute('ActiveSession');
          } else {
            setInitialRoute('TaskPicker');
          }
        }

        if (!prefs.hasOnboarded) {
          await store.seedPresetTasks();
        }
      } catch {
        setInitialRoute('Welcome');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Native blocked-attempt events: LOG ONLY. The block surface is the
  // native overlay on the blocked app (ADR-0008); these events arrive while
  // StayT is backgrounded, so navigating here pushed an interstitial nobody
  // saw — it then greeted the user on their next return to StayT. The
  // interstitial is reached only through user-initiated deep links below.
  useEffect(() => {
    const unsub = AppBlocker.onBlockedAttempt(async (event) => {
      try {
        const task = await taskForBlock(event.packageName);
        // Dumbphone gate is per-task: strict blocking, nothing counts.
        // Every block is one 'give_in'; a later override/break replaces it
        // (deleteLatestGiveIn). shouldLogEntry dedups emit + deep-link
        // double delivery of the same block.
        if (!isSelfTestRunning() && task?.dumbphoneMode !== true && shouldLogEntry(event.packageName)) {
          await store.saveBlockedAttempt({
            id: newBlockedId(),
            packageName: event.packageName,
            taskId: task?.id ?? '',
            timestamp: event.timestamp ?? Date.now(),
            action: 'give_in',
          });
        }
      } catch {
        // Logging must never crash the app.
      }
    });
    return unsub;
  }, []);

  // Cold-start / background tap on the "blocked app" notification deep-links here.
  useEffect(() => {
    const handleUrl = async (url: string) => {
      // Overlay SWITCH TASK lands here — TaskPicker, no session write
      // (picking a new task supersedes via the zombie-session logic).
      if (AppBlocker.isTasksDeepLink(url)) {
        if (navigationRef.isReady()) navigationRef.navigate('TaskPicker');
        return;
      }
      // P2-2: QS-tile locked state routes to the paywall.
      if (AppBlocker.isPaywallDeepLink(url)) {
        if (navigationRef.isReady()) navigationRef.navigate('Paywall');
        return;
      }
      const link = AppBlocker.parseBlockedDeepLink(url);
      if (!link || !navigationRef.isReady()) return;
      if (!claimBlockedNav(link.packageName)) return;
      try {
        const task = await taskForBlock(link.packageName);
        // Dumbphone gate is per-task (source of truth), same as the live path above.
        const dumfound = task?.dumbphoneMode === true;
        try {
          // The overlay's MORE OPTIONS (ADR-0008) opens this link for a
          // block the emit already logged: skip when this package's latest
          // record is a give_in from the last 2 min. Cold starts (dead JS at
          // block time, no emit) still log.
          const attempts = await store.getBlockedAttempts().catch(() => []);
          const lastForPkg = [...attempts].reverse().find(a => a.packageName === link.packageName);
          const alreadyLogged =
            lastForPkg?.action === 'give_in' && Date.now() - lastForPkg.timestamp < 2 * 60 * 1000;
          if (!dumfound && !alreadyLogged && shouldLogEntry(link.packageName)) {
            await store.saveBlockedAttempt({
              id: newBlockedId(),
              packageName: link.packageName,
              taskId: task?.id ?? '',
              timestamp: Date.now(),
              action: 'give_in',
            });
          }
        } catch {
          // Logging must never block the interstitial.
        }
        showBlockedInterstitial(
          link.packageName,
          task?.id ?? '',
          link.appLabel ?? link.packageName,
        );
      } catch {
        // Best-effort navigation; must never crash the app.
      }
    };
    const sub = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url).catch(() => {});
    });
    Linking.getInitialURL()
      .then(url => {
        if (url) handleUrl(url).catch(() => {});
      })
      .catch(() => {});
    return () => sub.remove();
  }, []);

  // Hide splash screen once fonts are resolved and initial route is ready.
  // fontError is treated like loaded so a missing font can't stick the splash.
  useEffect(() => {
    if ((fontsLoaded || fontError) && !loading) {
      SplashScreen.hideAsync();
      // UMP consent form (EEA/UK) over the first real screen, then SDK init.
      initAds().catch(() => {});
    }
  }, [fontsLoaded, fontError, loading]);

  // N-2 reminders boot: foreground handler + never-during-session guard once,
  // then (re)pair the single daily nudge. Expo-notifications also restores
  // scheduled reminders from its own boot receiver, so this doubles as the
  // boot-path repair.
  useEffect(() => {
    ensureReminderHandler();
    const unsubGuard = setupReminderGuard();
    ensureDailyReminder().catch(() => {});
    return unsubGuard;
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? colors.midnight : colors.paper }}>
        <ActivityIndicator size="large" color={colors.ectoGreen} />
      </View>
    );
  }

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator initialRouteName={initialRoute}>
          <Stack.Screen
            name="Welcome"
            component={WelcomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PermissionSetup"
            component={PermissionSetupScreen}
            options={{ headerShown: false }}
            // Boot-resume with the service off: granting resumes this exact
            // task via the existing pendingTaskId → autoStartTaskId flow
            // (which supersedes the unprotected session with a fresh start).
            initialParams={resumeParams ? { pendingTaskId: resumeParams.task.id } : undefined}
          />
          <Stack.Screen
            name="Paywall"
            component={PaywallScreen}
            options={{ headerShown: false, presentation: 'modal' }}
          />
          <Stack.Screen
            name="TaskPicker"
            component={TaskPickerScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="TaskSetup"
            component={TaskSetupScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ActiveSession"
            component={ActiveSessionScreen}
            options={{ headerShown: false }}
            // Process-death restore target (initialRoute above). The screen
            // treats params as a fallback and hydrates from the store.
            initialParams={resumeParams ?? undefined}
          />
          <Stack.Screen
            name="BlockedInterstitial"
            component={BlockedInterstitialScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="SessionDetail"
            component={SessionDetailScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PrivacyPolicy"
            component={PrivacyPolicyScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      {/* Edge-to-edge leaves the status bar transparent: scrolled content
          slid under the clock/icons on every scrolling screen. One
          theme-colored strip behind it, app-wide, in both themes. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: StatusBar.currentHeight ?? 0,
          backgroundColor: isDark ? darkColors.paper : colors.paper,
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppNavigator />
    </ThemeProvider>
  );
}
