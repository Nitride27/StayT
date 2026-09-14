import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Linking,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { GearIcon, BoltIcon, CheckIcon, BookIcon, CloseIcon, ChevronLeftIcon } from '../components/icons';
import { mascotSource } from '../theme/mascot';
import AppBlocker from '../native/AppBlocker';
import { ensureDailyReminder, cancelDailyReminder } from '../notifications/reminders';
import { useBlockSelfTest, resolveSelfTestApp } from '../blocktest/useBlockSelfTest';
import appConfig from '../../app.json';

const appVersion: string = appConfig.expo.version;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Settings'>;
};

type ThemeMode = 'light' | 'dark' | 'system';
const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'system', label: 'System' },
];

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function SectionHeader({ label, color, glyph }: { label: string; color: string; glyph: React.ReactNode }) {
  return (
    <View style={sectionHeaderStyles.row}>
      <View style={[sectionHeaderStyles.glyphBox, label === 'DANGER ZONE' && sectionHeaderStyles.glyphDanger]}>
        {glyph}
      </View>
      <Text style={[sectionHeaderStyles.label, { color }]}>{label}</Text>
    </View>
  );
}

const sectionHeaderStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
  },
  glyphBox: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glyphDanger: {
    backgroundColor: colors.danger,
  },
  label: {
    ...typography.label,
  },
});

export default function SettingsScreen({ navigation }: Props) {
  const { isDark, colors: theme, mode, setMode } = useTheme();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [versionTaps, setVersionTaps] = useState(0);
  // N-1: actual OS permission state (may disagree with the pref toggle).
  const [osNotifGranted, setOsNotifGranted] = useState(true);
  // P0-2 self-test state machine (blocking auto-releases on every path).
  const selfTest = useBlockSelfTest();
  const [testApp, setTestApp] = useState({ packageName: '', appName: '' });

  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const bodyOpacity = useSharedValue(0);
  const bodyTranslateY = useSharedValue(20);

  React.useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
    bodyOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    bodyTranslateY.value = withDelay(250, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const loadPrefs = async () => {
    try {
      const prefs = await store.getPreferences();
      setNotificationsEnabled(prefs.notificationsEnabled);
      setHapticsEnabled(prefs.hapticFeedback);
      setIsSubscribed(prefs.isSubscribed === true);
    } catch {
      // Keep defaults; settings must never trap on a storage error.
    }
    // N-1: surface the real OS state alongside the pref toggle.
    try {
      setOsNotifGranted(await AppBlocker.isNotificationPermissionGranted());
    } catch {
      // Keep previous value on error.
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadPrefs().catch(() => {});
    }, []),
  );

  const savePrefs = async (patch: { notificationsEnabled?: boolean; hapticFeedback?: boolean }) => {
    try {
      const prefs = await store.getPreferences();
      await store.savePreferences({ ...prefs, ...patch });
    } catch {
      // Best-effort.
    }
  };

  const handleTheme = (key: ThemeMode) => {
    // setMode flips instantly AND persists via ThemeContext.
    setMode(key);
  };

  const handleNotifications = async (value: boolean) => {
    setNotificationsEnabled(value);
    await savePrefs({ notificationsEnabled: value });
    if (value) {
      // Android never re-prompts once denied — send the user to system settings.
      const granted = await AppBlocker.isNotificationPermissionGranted().catch(() => false);
      setOsNotifGranted(granted);
      if (!granted) {
        Linking.openSettings().catch(() => {});
      } else {
        // N-2: toggle ON (re)pairs the single daily nudge.
        await ensureDailyReminder().catch(() => {});
      }
    } else {
      // N-2: one-tap off cancels the scheduled nudge.
      await cancelDailyReminder().catch(() => {});
    }
  };

  const handleHaptics = async (value: boolean) => {
    setHapticsEnabled(value);
    await savePrefs({ hapticFeedback: value });
  };

  // P0-2 self-test: block the first task's app, prove detection end-to-end.
  // B2: refuses while a session is active — the test would hijack its blocks.
  const handleStartSelfTest = async () => {
    const app = await resolveSelfTestApp();
    setTestApp(app);
    const result = await selfTest.start(app.packageName);
    if (result === 'session-active') {
      Alert.alert('End your session first', 'Stop your current focus session before testing blocks.');
    }
  };

  const handleResetOnboarding = () => {
    Alert.alert('Reset onboarding?', 'You will see the welcome flow again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            const prefs = await store.getPreferences();
            await store.savePreferences({ ...prefs, hasOnboarded: false });
          } catch {}
          navigation.reset({ routes: [{ name: 'Welcome' }] });
        },
      },
    ]);
  };

  const handleClearHistory = () => {
    Alert.alert('Clear history?', 'All sessions and blocked attempts will be deleted. Tasks stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            // Release blocking first — wiping sessions must not orphan it ON.
            await AppBlocker.stopBlocking().catch(() => {});
            await store.clearSessions();
            await store.clearBlockedAttempts();
          } catch {}
        },
      },
    ]);
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const bodyAnimStyle = useAnimatedStyle(() => ({
    opacity: bodyOpacity.value,
    transform: [{ translateY: bodyTranslateY.value }],
  }));

  const ink = isDark ? darkColors.ink : colors.midnight;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const cardBorder = isDark ? darkColors.ink : colors.ink;

  return (
    <View style={[styles.container, { backgroundColor: theme.paper }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.header, headerAnimStyle]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backIcon} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeftIcon size={24} color={ink} />
            </TouchableOpacity>
            <View style={{ width: 50 }} />
          </View>
          <Text style={[typography.display, { color: ink, marginTop: spacing.md }]}>SETTINGS</Text>
          <Image source={mascotSource('coffee', isDark)} style={styles.mascotImage} resizeMode="contain" />
        </Animated.View>

        <Animated.View style={bodyAnimStyle}>
          {/* Appearance */}
          <SectionHeader label="APPEARANCE" color={theme.inkSecondary} glyph={<GearIcon size={16} color={colors.midnight} />} />
          <View style={styles.segmentRow}>
              {THEME_OPTIONS.map(opt => {
                const active = mode === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    activeOpacity={0.8}
                    onPress={() => handleTheme(opt.key)}
                    style={[
                      styles.segment,
                      active && styles.segmentActive,
                      { backgroundColor: active ? colors.ectoGreen : 'transparent', borderColor: theme.ink },
                    ]}
                  >
                    <Text
                      style={[
                        typography.button,
                        { color: active ? colors.midnight : theme.inkSecondary, textAlign: 'center' },
                      ]}
                    >
                      {opt.label.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
          </View>

          {/* Feedback */}
          <SectionHeader label="FEEDBACK" color={theme.inkSecondary} glyph={<BoltIcon size={16} color={colors.midnight} />} />
          <View style={[styles.rowBox, styles.rowSplit, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.rowText}>
              <Text style={[typography.bodyStrong, { color: ink }]}>Notifications</Text>
              {/* N-1: say plainly when the OS disagrees with the toggle. */}
              {notificationsEnabled && !osNotifGranted && (
                <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.xs }]}>
                  System notifications are off — turn the toggle on again to open system settings.
                </Text>
              )}
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotifications}
              trackColor={{ false: theme.inkFaint, true: colors.ectoGreen }}
              thumbColor={theme.paperCard}
            />
          </View>
          <View style={[styles.rowBox, styles.rowSplit, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[typography.bodyStrong, { color: ink }]}>Haptics</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={handleHaptics}
              trackColor={{ false: theme.inkFaint, true: colors.ectoGreen }}
              thumbColor={theme.paperCard}
            />
          </View>

          {/* Subscription */}
          <SectionHeader label="SUBSCRIPTION" color={theme.inkSecondary} glyph={<CheckIcon size={16} color={colors.midnight} />} />
          {isSubscribed ? (
            <View style={[styles.proPill, { backgroundColor: colors.ectoGreen, borderColor: cardBorder }]}>
              <Text style={[typography.label, { color: colors.midnight }]}>STAYT PRO — ACTIVE</Text>
            </View>
          ) : (
            <View style={[styles.rowBox, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <Text style={[typography.bodyStrong, { color: ink }]}>Free plan</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Paywall')}
                style={styles.upgradeButton}
              >
                  <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
                  UPGRADE
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* About — static text only */}
          <SectionHeader label="SUPPORT" color={theme.inkSecondary} glyph={<BookIcon size={16} color={colors.midnight} />} />
          {/* P0-2 self-test lives here so it is reachable after onboarding too. */}
          <View style={[styles.rowBox, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[typography.bodyStrong, { color: ink }]}>Test my blocks</Text>
            <Text style={[typography.caption, { color: theme.inkSecondary }]}>
              Blocks your first task app for 60 seconds to prove detection works.
            </Text>
            {selfTest.state === 'idle' && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={handleStartSelfTest}
                style={styles.upgradeButton}
              >
                <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
                  START TEST
                </Text>
              </TouchableOpacity>
            )}
            {selfTest.state === 'waiting' && (
              <>
                <Text style={[typography.caption, { color: theme.inkSecondary }]}>
                  {`Now open ${testApp.appName || 'the app'} — StayT should block it (${selfTest.remaining}s)`}
                </Text>
                <TouchableOpacity activeOpacity={0.7} onPress={selfTest.cancel} style={styles.ghostButton}>
                  <Text style={[typography.button, { color: theme.inkSecondary, textAlign: 'center' }]}>CANCEL TEST</Text>
                </TouchableOpacity>
              </>
            )}
            {selfTest.state === 'success' && (
              <>
                <Text style={[typography.bodyStrong, { color: ink }]}>Blocks are working.</Text>
                <TouchableOpacity activeOpacity={0.7} onPress={selfTest.cancel} style={styles.ghostButton}>
                  <Text style={[typography.button, { color: theme.inkSecondary, textAlign: 'center' }]}>DISMISS</Text>
                </TouchableOpacity>
              </>
            )}
            {(selfTest.state === 'timeout' || selfTest.state === 'error') && (
              <>
                <Text style={[typography.caption, { color: theme.inkSecondary }]}>
                  {selfTest.state === 'timeout'
                    ? 'No block detected in 60s. Open the app while it is blocked, then retry.'
                    : 'Could not start blocking. Check the permission and retry.'}
                </Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleStartSelfTest}
                  style={styles.upgradeButton}
                >
                  <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
                    RETRY TEST
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          <View style={[styles.rowBox, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Text style={[typography.bodyStrong, { color: ink }]}>StayT</Text>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={async () => {
                // DEV ONLY: 5 taps on the version toggles Pro for testing.
                // __DEV__ is false in production builds, so this can't ship.
                if (!__DEV__) return;
                const next = versionTaps + 1;
                setVersionTaps(next);
                if (next >= 5) {
                  setVersionTaps(0);
                  try {
                    const prefs = await store.getPreferences();
                    const flipped = !prefs.isSubscribed;
                    await store.savePreferences({ ...prefs, isSubscribed: flipped });
                    setIsSubscribed(flipped);
                    Alert.alert(
                      'Dev Pro toggle',
                      flipped ? 'Pro ON (testing only).' : 'Pro OFF (testing only).',
                    );
                  } catch {}
                }
              }}
            >
              <Text style={[typography.caption, { color: theme.inkSecondary, marginTop: spacing.xs }]}>
                v{appVersion} · SMALL STEPS. BUILD BIG PROGRESS.
              </Text>
            </TouchableOpacity>
          </View>

          {/* Danger zone */}
          <SectionHeader label="DANGER ZONE" color={colors.danger} glyph={<CloseIcon size={16} color="#ffffff" />} />
          <TouchableOpacity activeOpacity={0.7} onPress={handleResetOnboarding} style={[styles.rowBox, styles.dangerBox, { backgroundColor: cardBg }]}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>Reset onboarding</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={handleClearHistory} style={[styles.rowBox, styles.dangerBox, { backgroundColor: cardBg }]}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>Clear history</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
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
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  mascotImage: {
    width: 150,
    height: 150,
    marginTop: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navLink: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: radius.md,
  },
  backIcon: {
    width: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowBox: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  rowText: {
    flex: 1,
    marginRight: spacing.md,
  },
  ghostButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  dangerBox: {
    borderColor: colors.danger,
  },
  rowSplit: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  segmentRow: {
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  segmentActive: {
    borderBottomWidth: 5,
    borderBottomColor: colors.ectoGreenDark,
  },
  freeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
  },
  upgradeButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 14,
    paddingHorizontal: spacing.xl,
    marginLeft: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  proPill: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
