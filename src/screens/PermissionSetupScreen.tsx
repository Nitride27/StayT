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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
} from 'react-native-reanimated';
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

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function getOEMTip(): string | null {
  if (Platform.OS !== 'android') return null;
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer =
    (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  const hay = `${manufacturer} ${model}`;
  if (hay.includes('xiaomi') || hay.includes('redmi') || hay.includes('poco'))
    return 'Xiaomi: Settings > Apps > Manage apps > StayT > Autostart ON';
  if (hay.includes('samsung'))
    return 'Samsung: Settings > Battery > StayT > Allow background activity';
  if (hay.includes('huawei') || hay.includes('honor'))
    return 'Huawei: Settings > Battery > App launch > StayT > Manage manually';
  if (hay.includes('oppo') || hay.includes('realme') || hay.includes('oneplus'))
    return 'OPPO/OnePlus: Settings > Battery > App battery management > StayT > Allow background activity';
  if (hay.includes('vivo') || hay.includes('iqoo'))
    return 'Vivo: Settings > Battery > Background power consumption > StayT > Allow';
  if (hay.includes('motorola') || hay.includes('moto'))
    return 'Motorola: Settings > Battery > Adaptive Battery > exclude StayT';
  if (hay.includes('nothing'))
    return 'Nothing: Settings > Battery > StayT > Unrestricted';
  return null;
}

// Shown on EVERY Android device — OEM killers break blocking silently,
// so the generic path is always visible, with an OEM-specific line on top.
const GENERIC_BATTERY_TIP =
  'Keep StayT running: Settings > Apps > StayT > Battery > Unrestricted.';

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

// Wave 2C2 per-OEM survival steps (additive, static text, no new
// permissions). Each brand: recents-lock + Autostart/battery +
// "No restrictions" lines.
function getOEMSurvivalSteps(): string[] {
  if (Platform.OS !== 'android') return [];
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer =
    (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  const hay = `${manufacturer} ${model}`;
  if (hay.includes('xiaomi') || hay.includes('redmi') || hay.includes('poco'))
    return [
      'Lock StayT in Recents so MIUI / HyperOS cannot swipe it away.',
      'Autostart ON for StayT (Settings > Apps > StayT).',
      'Battery saver → No restrictions for StayT.',
    ];
  if (hay.includes('huawei') || hay.includes('honor'))
    return [
      'Lock StayT in Recents so EMUI cannot close it.',
      'App launch > StayT > Manage manually, all toggles ON.',
      'Battery → No restrictions for StayT.',
    ];
  if (hay.includes('oppo') || hay.includes('realme'))
    return [
      'Lock StayT in Recents so ColorOS cannot close it.',
      'Autostart ON for StayT.',
      'App battery management → No restrictions for StayT.',
    ];
  if (hay.includes('oneplus'))
    return [
      'Lock StayT in Recents so OxygenOS cannot close it.',
      'Autostart ON for StayT.',
      'Battery optimization → Don\u2019t optimize StayT.',
    ];
  if (hay.includes('samsung'))
    return [
      'Lock StayT in Recents so One UI cannot close it.',
      'Never-sleeping apps: add StayT.',
      'Battery → Unrestricted for StayT.',
    ];
  if (hay.includes('vivo') || hay.includes('iqoo'))
    return [
      'Lock StayT in Recents.',
      'Autostart ON for StayT.',
      'Background power consumption → Allow for StayT.',
    ];
  if (hay.includes('motorola') || hay.includes('moto'))
    return [
      'Lock StayT in Recents.',
      'Adaptive Battery: exclude StayT.',
      'Battery → Unrestricted for StayT.',
    ];
  if (hay.includes('nothing'))
    return [
      'Lock StayT in Recents.',
      'Autostart ON for StayT.',
      'Battery → Unrestricted for StayT.',
    ];
  return [
    'Lock StayT in Recents so the system cannot close it.',
    'Autostart ON for StayT where available.',
    'Battery → Unrestricted (No restrictions) for StayT.',
  ];
}

export default function PermissionSetupScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const appState = useRef(AppState.currentState);
  const oemTip = getOEMTip();
  // P0-2 self-test + N-2 inline notification prompt (each fires once).
  const selfTest = useBlockSelfTest();
  const [testApp, setTestApp] = useState({ packageName: '', appName: '' });
  const notifAsked = useRef(false);
  // Restricted-settings escape hatch: shown when the user returns from the
  // accessibility page without the grant (silent sideload refusal).
  const [showRestricted, setShowRestricted] = useState(false);
  const a11yAttempts = useRef(0);

  // --- Animations ---
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const mascotScale = useSharedValue(0.8);
  const mascotOpacity = useSharedValue(0);
  const oemOpacity = useSharedValue(0);
  const oemTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    mascotOpacity.value = withDelay(150, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    mascotScale.value = withDelay(150, withSpring(1, { damping: 16, stiffness: 200 }));

    oemOpacity.value = withDelay(500, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    oemTranslateY.value = withDelay(500, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(600, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

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
    // P0-2: a running test owns the screen; success advances, timeout/error
    // wait for the manual continue so nobody is trapped or skipped.
    if (selfTest.state === 'waiting') return;
    if (selfTest.state === 'timeout' || selfTest.state === 'error') return;
    const delay = selfTest.state === 'success' ? 800 : 1200;
    const timer = setTimeout(() => {
      // A gated TaskPicker tap carries its task id through: granting resumes
      // that exact tap instead of dropping the user on the list.
      const pendingTaskId = route.params?.pendingTaskId;
      const next = pendingTaskId ? { autoStartTaskId: pendingTaskId } : undefined;
      markOnboarded().finally(() => navigation.navigate('TaskPicker', next));
    }, delay);
    return () => clearTimeout(timer);
  }, [accessibilityEnabled, navigation, selfTest.state, route.params?.pendingTaskId]);

  // --- Animated styles ---
  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const mascotAnimStyle = useAnimatedStyle(() => ({
    opacity: mascotOpacity.value,
    transform: [{ scale: mascotScale.value }],
  }));

  const oemAnimStyle = useAnimatedStyle(() => ({
    opacity: oemOpacity.value,
    transform: [{ translateY: oemTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

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

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
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
        <Animated.View style={[styles.mascotContainer, mascotAnimStyle]}>
          <Image
            source={mascotSource('phone', isDark)}
            style={[styles.mascotImage, { width: mascotSize, height: mascotSize }]}
            resizeMode="contain"
          />
        </Animated.View>

        {/* Header */}
        <Animated.View style={[styles.header, headerAnimStyle]}>
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
            StayT needs Accessibility permission to check which app is open, so it can block distractions while you work.
          </Text>
        </Animated.View>

        {/* Battery guidance: OEM-specific on top, generic path always */}
        {Platform.OS === 'android' && (
          <Animated.View style={[styles.oemCard, oemAnimStyle, { backgroundColor: bg, borderColor: ink }]}>
            {oemTip && (
              <Text
                style={[
                  typography.bodyStrong,
                  { color: ink, textAlign: 'center' },
                ]}
              >
                {oemTip}
              </Text>
            )}
            <Text
              style={[
                typography.caption,
                { color: muted, textAlign: 'center', marginTop: oemTip ? spacing.xs : 0 },
              ]}
            >
              {GENERIC_BATTERY_TIP}
            </Text>
          </Animated.View>
        )}

        {/* OEM survival flow: numbered rows, each with its own OPEN
            button to the exact system screen. Recents lock has no
            system page, so it shows text only. */}
        {Platform.OS === 'android' && (
          <View style={[styles.oemKeepCard, { backgroundColor: bg, borderColor: ink }]}>
            <Text style={[typography.cta, { color: ink, textAlign: 'center' }]}>
              KEEP STAYT ALIVE
            </Text>
            {getOEMSurvivalSteps().map((step, index) => (
              <View key={step} style={styles.oemStepRow}>
                <Text style={[typography.caption, { color: muted, flex: 1 }]}>
                  {`${index + 1}. ${step}`}
                </Text>
                {index === 1 && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleOpenManufacturer}
                    style={styles.oemStepOpenButton}
                    accessibilityRole="button"
                    accessibilityLabel="Open manufacturer settings"
                  >
                    <Text style={styles.oemStepOpenText}>OPEN</Text>
                  </TouchableOpacity>
                )}
                {index === 2 && (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleOpenBattery}
                    style={styles.oemStepOpenButton}
                    accessibilityRole="button"
                    accessibilityLabel="Open battery settings"
                  >
                    <Text style={styles.oemStepOpenText}>OPEN</Text>
                  </TouchableOpacity>
                )}
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
      </View>
      </ScrollView>

      {/* Bottom section */}
      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        {!accessibilityEnabled ? (
          <AnimatedTouchable
            style={styles.primaryButton}
            activeOpacity={0.85}
            onPress={handleGrantAccessibility}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
          >
            <Text style={styles.primaryButtonText}>OPEN SETTINGS</Text>
          </AnimatedTouchable>
        ) : (
          <View style={[styles.testCard, { borderColor: ink }]}>
            <Text style={[typography.bodyStrong, { color: ink, textAlign: 'center' }]}>
              Permission granted
            </Text>
            {selfTest.state === 'idle' && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleStartSelfTest}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>TEST MY BLOCKS</Text>
              </TouchableOpacity>
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
  oemCard: {
    padding: spacing.lg,
    borderWidth: 2,
    borderRadius: radius.md,
    marginTop: spacing.xl,
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
