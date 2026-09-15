import React, { useState, useEffect } from 'react';
import { StatusBar, View, ActivityIndicator, Linking } from 'react-native';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
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
import SettingsScreen from './src/screens/SettingsScreen';
import PermissionSetupScreen from './src/screens/PermissionSetupScreen';
import PaywallScreen from './src/screens/PaywallScreen';
import { store } from './src/storage/store';
import { Task, Session } from './src/types';
import AppBlocker from './src/native/AppBlocker';
import { decideEntry } from './src/navigation/blockedEntry';
import {
  ensureReminderHandler,
  setupReminderGuard,
  ensureDailyReminder,
} from './src/notifications/reminders';
import { colors } from './src/theme/tokens';

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
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// M7: BAL-delayed re-entries (>1500ms late) would otherwise double-log one
// block as two give_ins. Skip the log when the same package logged <5s ago;
// the interstitial still shows.
const lastLoggedAt = new Map<string, number>();
function shouldLogGiveIn(packageName: string): boolean {
  const now = Date.now();
  const last = lastLoggedAt.get(packageName) ?? 0;
  if (now - last < 5000) return false;
  lastLoggedAt.set(packageName, now);
  return true;
}

// M1: collision-proof record IDs — two blocks in the same millisecond must
// never share an ID.
function newBlockedId(): string {
  return `blocked-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function AppNavigator() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('Welcome');
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

        // Reconcile zombie sessions left `active` by a process kill:
        // close them so History never renders phantom 0m rows.
        // M6: a killed demo leaves an orphan isDemo task — with no session to
        // own it after the reconcile, delete it so it never counts or lingers.
        try {
          const sessions = await store.getSessions();
          const now = Date.now();
          for (const s of sessions) {
            if (s.status === 'active') {
              const duration = Math.max(0, now - s.startedAt);
              await store.saveSession({ ...s, status: 'completed', endedAt: now, duration });
            }
          }
          const settled = await store.getSessions();
          if (!settled.some(s => s.status === 'active')) {
            const tasks = await store.getTasks();
            for (const t of tasks) {
              if (t.isDemo === true) {
                await store.deleteTask(t.id).catch(() => {});
              }
            }
          }
        } catch {
          // Best-effort; a failed reconcile must not block boot.
        }

        if (!prefs.hasOnboarded) {
          setInitialRoute('Welcome');
        } else {
          const accessGranted = await AppBlocker.isAccessibilityServiceEnabled();
          if (!accessGranted) {
            setInitialRoute('PermissionSetup');
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

  // Listen for native blocked-attempt events and navigate to interstitial
  useEffect(() => {
    const unsub = AppBlocker.onBlockedAttempt(async (event) => {
      try {
        if (!claimBlockedNav(event.packageName)) return;
        const tasks = await store.getTasks();
        const task = tasks.find(
          t => t.packageName === event.packageName || t.blockedPackages?.includes(event.packageName),
        );
        // P0-1/P1-4 stats need every block recorded: the attempt itself is a
        // 'give_in'; a later override adds a separate 'override' record, so
        // resists (action != 'override') stay exact. Best-effort, never crash.
        // M1: the override/break path deletes this give_in, so each block
        // yields exactly one record. M7: late re-entries skip the log.
        try {
          if (shouldLogGiveIn(event.packageName)) {
            await store.saveBlockedAttempt({
              id: newBlockedId(),
              packageName: event.packageName,
              taskId: task?.id ?? '',
              timestamp: event.timestamp ?? Date.now(),
              action: 'give_in',
            });
          }
        } catch {
          // Logging must never block the interstitial.
        }
        if (navigationRef.isReady()) {
          navigationRef.navigate('BlockedInterstitial', {
            packageName: event.packageName,
            taskId: task?.id ?? '',
            appLabel: event.appLabel ?? event.packageName,
          });
        }
      } catch {
        // Best-effort navigation; a missed interstitial must never crash the app.
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
        const tasks = await store.getTasks();
        const task = tasks.find(
          t => t.packageName === link.packageName || t.blockedPackages?.includes(link.packageName),
        );
        try {
          if (shouldLogGiveIn(link.packageName)) {
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
        navigationRef.navigate('BlockedInterstitial', {
          packageName: link.packageName,
          taskId: task?.id ?? '',
          appLabel: link.appLabel ?? link.packageName,
        });
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
            name="Settings"
            component={SettingsScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
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
