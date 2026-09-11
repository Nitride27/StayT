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
import { colors } from './src/theme/tokens';

SplashScreen.preventAutoHideAsync();

export type RootStackParamList = {
  Welcome: undefined;
  PermissionSetup: undefined;
  Paywall: undefined;
  TaskPicker: undefined;
  TaskSetup: { task?: Task };
  ActiveSession: { task: Task; session: Session };
  BlockedInterstitial: { packageName: string; taskId: string; appLabel?: string };
  History: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Dedup: one block event fires BOTH the JS emit and the deep-link foreground
// rung — without this guard a single block pushes two interstitials.
let lastBlockedNavAt = 0;
let lastBlockedPkg = '';
function shouldNavigateBlocked(packageName: string): boolean {
  const now = Date.now();
  if (packageName === lastBlockedPkg && now - lastBlockedNavAt < 2000) return false;
  lastBlockedPkg = packageName;
  lastBlockedNavAt = now;
  return true;
}

function AppNavigator() {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(true);
  const [initialRoute, setInitialRoute] = useState<keyof RootStackParamList>('Welcome');
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

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
        if (!shouldNavigateBlocked(event.packageName)) return;
        const tasks = await store.getTasks();
        const task = tasks.find(
          t => t.packageName === event.packageName || t.blockedPackages?.includes(event.packageName),
        );
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
      const link = AppBlocker.parseBlockedDeepLink(url);
      if (!link || !navigationRef.isReady()) return;
      if (!shouldNavigateBlocked(link.packageName)) return;
      try {
        const tasks = await store.getTasks();
        const task = tasks.find(
          t => t.packageName === link.packageName || t.blockedPackages?.includes(link.packageName),
        );
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
