import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  AppState,
  AppStateStatus,
  Linking,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import AppBlocker from '../native/AppBlocker';
import { store } from '../storage/store';
import { ensureDailyReminder } from '../notifications/reminders';
import { useBlockSelfTest, resolveSelfTestApp } from '../blocktest/useBlockSelfTest';
import { tap } from '../haptics';
import { Platform } from 'react-native';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PermissionSetup'>;
  route: { params?: { pendingTaskId?: string } };
};


type Brand = 'samsung' | 'xiaomi' | 'huawei' | 'oppo' | 'oneplus' | 'vivo' | 'motorola' | 'nothing' | 'other';

function detectBrand(): Brand {
  if (Platform.OS !== 'android') return 'other';
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer = (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  const hay = `${manufacturer} ${model}`;
  if (hay.includes('samsung')) return 'samsung';
  if (hay.includes('xiaomi') || hay.includes('redmi') || hay.includes('poco')) return 'xiaomi';
  if (hay.includes('huawei') || hay.includes('honor')) return 'huawei';
  if (hay.includes('oppo') || hay.includes('realme')) return 'oppo';
  if (hay.includes('oneplus')) return 'oneplus';
  if (hay.includes('vivo') || hay.includes('iqoo')) return 'vivo';
  if (hay.includes('motorola') || hay.includes('moto')) return 'motorola';
  if (hay.includes('nothing')) return 'nothing';
  return 'other';
}

// What to tap after OPEN SETTINGS lands on the Accessibility page. Apps
// can't deep-link to one service's page (OPEN_ACCESSIBILITY_DETAILS_SETTINGS
// is system-only, verified on-device), so the list name has to be exact.
// Samsung One UI verified on-device: "Installed apps".
function accessibilitySteps(brand: Brand): string[] {
  const list = brand === 'samsung' ? 'Installed apps' : 'Downloaded apps (on some phones: Installed apps)';
  return [
    'Tap OPEN SETTINGS below.',
    `Tap ${list}, then StayT.`,
    'Turn StayT on and tap Allow.',
    'Come back here. StayT continues on its own.',
  ];
}

type KeepAliveRow = { title: string; how: string; open: 'battery' | 'oem' };

// Optional hardening against phones that close apps in the background.
// Each row says exactly what to tap on the screen its OPEN button opens.
// Battery row verified on-device: App info > Battery > Unrestricted.
function keepAliveRows(brand: Brand): KeepAliveRow[] {
  const rows: KeepAliveRow[] = [
    { title: 'Battery: Unrestricted', how: 'Tap Battery, then Unrestricted.', open: 'battery' },
  ];
  // Android 11+ can revoke an unused app's permissions; on the same App info
  // screen (verified on-device, M52).
  if (Platform.OS === 'android' && Number(Platform.Version) >= 30) {
    rows.push({
      title: 'Keep permissions',
      how: 'Turn off Remove permissions if app is unused.',
      open: 'battery',
    });
  }
  if (brand === 'samsung') {
    rows.push({
      title: 'Never sleeping apps',
      how: 'Tap Background usage limits, then Never sleeping apps, and add StayT.',
      open: 'oem',
    });
  } else if (brand === 'xiaomi' || brand === 'oppo' || brand === 'oneplus') {
    rows.push({ title: 'Autostart', how: 'Turn Autostart on for StayT.', open: 'oem' });
  } else if (brand === 'huawei') {
    rows.push({ title: 'App launch', how: 'Set StayT to Manage manually and turn every switch on.', open: 'oem' });
  } else if (brand === 'vivo') {
    rows.push({ title: 'Background startup', how: 'Allow StayT to start in the background.', open: 'oem' });
  }
  return rows;
}

// Fallback when a settings screen can't be opened.
const GENERIC_BATTERY_TIP = 'Open Settings > Apps > StayT > Battery and choose Unrestricted.';

// Last-resort manual path for the restricted-settings toggle, shown only
// when neither the native app-info intent nor the OS settings page opens.
const RESTRICTED_MANUAL_PATH =
  'Settings > Apps > StayT, tap \u22EE (top-right) > Allow restricted settings, then turn StayT on in Accessibility.';

// Sideloaded APKs (Android 13+) can be silently refused at the accessibility
// toggle — worst on HyperOS/MIUI and some Samsung builds. OEM-specific path
// to the app-info ⋮ > Allow restricted settings toggle.
function getRestrictedSettingsSteps(): string[] {
  if (Platform.OS !== 'android') return [];
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer =
    (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  const hay = `${manufacturer} ${model}`;
  if (hay.includes('xiaomi') || hay.includes('redmi') || hay.includes('poco'))
    return [
      'Open StayT\u2019s app-info page with the button below.',
      'Tap \u22EE (top-right) > Allow restricted settings.',
      'Come back here and tap OPEN SETTINGS again.',
    ];
  if (hay.includes('samsung'))
    return [
      'Open StayT\u2019s app-info page with the button below.',
      'Tap \u22EE (top-right) > Allow restricted settings.',
      'Come back here and tap OPEN SETTINGS again.',
    ];
  return [
    'Open StayT\u2019s app-info page with the button below.',
    'Tap \u22EE (top-right) > Allow restricted settings, if shown.',
    'Come back here and tap OPEN SETTINGS again.',
  ];
}

export default function PermissionSetupScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const appState = useRef(AppState.currentState);
  const brand = detectBrand();
  // P0-2 self-test + N-2 inline notification prompt (each fires once).
  const selfTest = useBlockSelfTest();
  const [testApp, setTestApp] = useState({ packageName: '', appName: '' });
  const notifAsked = useRef(false);
  // Restricted-settings escape hatch: shown when the user returns from the
  // accessibility page without the grant (silent sideload refusal).
  const [showRestricted, setShowRestricted] = useState(false);
  const a11yAttempts = useRef(0);

  // --- Check accessibility on mount ---
  useEffect(() => {
    const checkPermissions = async () => {
      const acc = await AppBlocker.isAccessibilityServiceEnabled();
      setAccessibilityEnabled(acc);
    };
    checkPermissions();
  }, []);

  // --- AppState listener: re-check accessibility when returning from settings ---
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        const acc = await AppBlocker.isAccessibilityServiceEnabled();
        setAccessibilityEnabled(acc);
        // Returned from system settings without the grant after asking at
        // least once: surface the restricted-settings escape hatch.
        if (acc) {
          setShowRestricted(false);
        } else if (a11yAttempts.current > 0) {
          setShowRestricted(true);
        }
      }
      appState.current = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // --- Auto-advance when accessibility is granted (paused for self-test) ---
  useEffect(() => {
    if (!accessibilityEnabled) return;
    // N-2: one inline notification ask on the way through onboarding.
    // Default ON after grant (Settings holds the one-tap off).
    if (!notifAsked.current) {
      notifAsked.current = true;
      AppBlocker.requestNotificationPermission()
        .then(async granted => {
          try {
            const prefs = await store.getPreferences();
            await store.savePreferences({ ...prefs, notificationsEnabled: granted });
            if (granted) await ensureDailyReminder().catch(() => {});
          } catch {
            // Best-effort.
          }
        })
        .catch(() => {});
    }
    // Stay on this page after the grant so the user can test blocks and
    // set up "Keep StayT running" (the old 1.2s auto-advance hid both).
    // Only a successful test moves on by itself; otherwise CONTINUE does.
    if (selfTest.state !== 'success') return;
    const timer = setTimeout(() => {
      // A gated TaskPicker tap carries its task id through: granting resumes
      // that exact tap instead of dropping the user on the list.
      const pendingTaskId = route.params?.pendingTaskId;
      const next = pendingTaskId ? { autoStartTaskId: pendingTaskId } : undefined;
      markOnboarded().finally(() => navigation.navigate('TaskPicker', next));
    }, 800);
    return () => clearTimeout(timer);
  }, [accessibilityEnabled, navigation, selfTest.state, route.params?.pendingTaskId]);

  // --- Handlers ---
  const markOnboarded = async () => {
    try {
      const prefs = await store.getPreferences();
      if (!prefs.hasOnboarded) {
        await store.savePreferences({ ...prefs, hasOnboarded: true });
      }
    } catch {
      // Best-effort; onboarding must never trap the user on a storage error.
    }
  };

  const handleGrantAccessibility = async () => {
    tap();
    a11yAttempts.current += 1;
    try {
      AppBlocker.openAccessibilitySettings();
    } catch {
      Alert.alert('Error', 'Could not open accessibility settings.');
    }
  };

  // Restricted-settings escape hatch: native app-info first, OS app
  // settings second (Linking.openSettings per Expo v57 docs), exact manual
  // path last — never leave the user guessing.
  const handleOpenAppInfo = async () => {
    tap();
    try {
      const ok = await AppBlocker.openAppInfoSettings();
      if (ok) return;
    } catch {
      // Fall through to the OS fallback below.
    }
    try {
      await Linking.openSettings();
    } catch {
      Alert.alert('Open StayT app info', RESTRICTED_MANUAL_PATH);
    }
  };

  // OEM survival flow: each row leads to its exact system screen.
  // Recents lock has no system page, so it shows text only.
  // Marks oemOnboardingDone on tap. Falls back to an Alert with the
  // exact path when a screen cannot open.
  const markOemDone = async () => {
    try {
      const prefs = await store.getPreferences();
      await store.savePreferences({ ...prefs, oemOnboardingDone: true });
    } catch {
      // Best-effort.
    }
  };

  const handleOpenManufacturer = async () => {
    tap();
    try {
      const ok = await AppBlocker.openManufacturerSettings();
      await markOemDone();
      if (!ok) {
        Alert.alert('Keep StayT alive', GENERIC_BATTERY_TIP);
      }
    } catch {
      await markOemDone();
      Alert.alert('Keep StayT alive', GENERIC_BATTERY_TIP);
    }
  };

  const handleOpenBattery = async () => {
    tap();
    try {
      const ok = await AppBlocker.openBatteryOptimizationSettings();
      await markOemDone();
      if (!ok) {
        Alert.alert('Keep StayT alive', GENERIC_BATTERY_TIP);
      }
    } catch {
      await markOemDone();
      Alert.alert('Keep StayT alive', GENERIC_BATTERY_TIP);
    }
  };

  // P0-2: block the first task's app, prove detection end-to-end.
  // B2: refuses while a session is active — the test would hijack its blocks.
  const handleStartSelfTest = async () => {
    tap();
    const app = await resolveSelfTestApp();
    setTestApp(app);
    const result = await selfTest.start(app.packageName);
    if (result === 'session-active') {
      Alert.alert('End your session first', 'Stop your current focus session before testing blocks.');
    }
  };

  const handleSelfTestContinue = () => {
    const pendingTaskId = route.params?.pendingTaskId;
    const next = pendingTaskId ? { autoStartTaskId: pendingTaskId } : undefined;
    markOnboarded().finally(() => navigation.navigate('TaskPicker', next));
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const secondary = isDark ? darkColors.inkSecondary : colors.inkSecondary;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  // Dynamic to screen size: fixed 220px mascots overflow small screens.
  const { height: winH } = useWindowDimensions();
  const mascotSize = Math.min(220, Math.max(120, Math.floor(winH * 0.22)));

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.topSection}>
        {/* Mascot */}
        <View style={styles.mascotContainer}>
          <Image
            source={mascotSource('phone', isDark)}
            style={[styles.mascotImage, { width: mascotSize, height: mascotSize }]}
            resizeMode="contain"
          />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text
            style={[
              typography.display,
              { color: ink, textAlign: 'center' },
            ]}
          >
            ONE QUICK PERMISSION
          </Text>
          <Text
            style={[
              typography.bodyStrong,
              {
                color: secondary,
                textAlign: 'center',
                marginTop: spacing.md,
                maxWidth: 300,
                alignSelf: 'center',
              },
            ]}
          >
            StayT needs Accessibility permission to see which app is open, read the address of websites you block and spot feeds you shield, so it can block distractions while you work. Nothing it sees leaves your phone.
          </Text>
        </View>

        {/* How to turn it on: exact taps for this phone's Accessibility page. */}
        {Platform.OS === 'android' && !accessibilityEnabled && (
          <View style={[styles.oemKeepCard, { backgroundColor: bg, borderColor: ink }]}>
            <Text style={[typography.cta, { color: ink, textAlign: 'center' }]}>HOW TO TURN IT ON</Text>
            {accessibilitySteps(brand).map((step, index) => (
              <View key={step} style={styles.oemStepRow}>
                <Text style={[typography.body, { color: ink, flex: 1 }]}>{`${index + 1}. ${step}`}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Restricted-settings escape hatch: sideloaded APKs can be silently
            refused at the accessibility toggle (HyperOS/MIUI, some Samsung).
            Shown only when the user came back without the grant. */}
        {Platform.OS === 'android' && showRestricted && !accessibilityEnabled && (
          <View style={[styles.oemKeepCard, { backgroundColor: bg, borderColor: ink }]}>
            <Text style={[typography.cta, { color: ink, textAlign: 'center' }]}>
              ALLOW RESTRICTED SETTINGS
            </Text>
            <Text
              style={[
                typography.caption,
                { color: muted, textAlign: 'center', marginTop: spacing.xs },
              ]}
            >
              StayT was installed outside the Play Store, so Android can silently refuse the permission above. Allow it once:
            </Text>
            {getRestrictedSettingsSteps().map((step, index) => (
              <View key={step} style={styles.oemStepRow}>
                <Text style={[typography.caption, { color: muted, flex: 1 }]}>
                  {`${index + 1}. ${step}`}
                </Text>
              </View>
            ))}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleOpenAppInfo}
              style={styles.oemKeepButton}
              accessibilityRole="button"
              accessibilityLabel="Open StayT app info"
            >
              <Text style={styles.oemStepOpenText}>OPEN APP INFO</Text>
            </TouchableOpacity>
          </View>
        )}
        {/* Optional: keep StayT running on phones that close background
            apps. Each row opens the screen its text describes. */}
        {Platform.OS === 'android' && (
          <View style={[styles.oemKeepCard, { backgroundColor: bg, borderColor: ink }]}>
            <Text style={[typography.cta, { color: ink, textAlign: 'center' }]}>KEEP STAYT RUNNING</Text>
            <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.xs }]}>
              Recommended. Some phones close apps in the background, which stops blocking.
            </Text>
            {keepAliveRows(brand).map(row => (
              <View key={row.title} style={styles.oemStepRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyStrong, { color: ink }]}>{row.title}</Text>
                  <Text style={[typography.caption, { color: muted }]}>{row.how}</Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={row.open === 'battery' ? handleOpenBattery : handleOpenManufacturer}
                  style={styles.oemStepOpenButton}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${row.title} settings`}
                >
                  <Text style={styles.oemStepOpenText}>OPEN</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>
      </ScrollView>

      {/* Bottom section */}
      <View style={styles.bottomSection}>
        {!accessibilityEnabled ? (
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.85}
            onPress={handleGrantAccessibility}
            accessibilityRole="button"
          >
            <Text style={styles.primaryButtonText}>OPEN SETTINGS</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.testCard, { borderColor: ink }]}>
            <Text style={[typography.bodyStrong, { color: ink, textAlign: 'center' }]}>
              Permission granted
            </Text>
            {selfTest.state === 'idle' && (
              <>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleStartSelfTest}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>TEST MY BLOCKS</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleSelfTestContinue}
                  style={styles.ghostButton}
                  accessibilityRole="button"
                >
                  <Text style={[typography.button, { color: muted, textAlign: 'center' }]}>CONTINUE</Text>
                </TouchableOpacity>
              </>
            )}
            {selfTest.state === 'waiting' && (
              <>
                <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
                  {`Now open ${testApp.appName || 'the app'}. StayT should block it (${selfTest.remaining}s)`}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={selfTest.cancel}
                  style={styles.ghostButton}
                >
                  <Text style={[typography.button, { color: muted, textAlign: 'center' }]}>CANCEL TEST</Text>
                </TouchableOpacity>
              </>
            )}
            {selfTest.state === 'success' && (
              <Text style={[typography.bodyStrong, { color: ink, textAlign: 'center', marginTop: spacing.sm }]}>
                Blocks are working. Continuing…
              </Text>
            )}
            {selfTest.state === 'timeout' && (
              <>
                <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
                  No block detected in 60s. Open the app while a session is blocking it, then retry.
                </Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleStartSelfTest}
                  style={[styles.primaryButton, { marginTop: spacing.sm }]}
                >
                  <Text style={styles.primaryButtonText}>RETRY TEST</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleSelfTestContinue}
                  style={styles.ghostButton}
                >
                  <Text style={[typography.button, { color: muted, textAlign: 'center' }]}>CONTINUE ANYWAY</Text>
                </TouchableOpacity>
              </>
            )}
            {selfTest.state === 'error' && (
              <>
                <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
                  Could not start blocking. Check the permission and retry.
                </Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleStartSelfTest}
                  style={[styles.primaryButton, { marginTop: spacing.sm }]}
                >
                  <Text style={styles.primaryButtonText}>RETRY TEST</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={handleSelfTestContinue}
                  style={styles.ghostButton}
                >
                  <Text style={[typography.button, { color: muted, textAlign: 'center' }]}>CONTINUE ANYWAY</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
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
  topSection: {
    flex: 1,
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  mascotContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  mascotImage: {
    width: 220,
    height: 220,
  },
  // Wave 2C2 OEM keep-alive card (additive, existing tokens only).
  oemKeepCard: {
    padding: spacing.lg,
    borderWidth: 2,
    borderRadius: radius.md,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  // Per-step rows: text plus its own OPEN button.
  oemStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  oemStepOpenButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 72,
  },
  oemStepOpenText: {
    ...typography.displaySmall,
    color: colors.midnight,
    textAlign: 'center',
  },
  oemKeepButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 18,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    alignSelf: 'stretch',
  },
  bottomSection: {
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
  testCard: {
    padding: spacing.lg,
    borderWidth: 2,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  ghostButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
