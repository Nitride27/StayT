import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
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
import { typography, spacing, radius, layout, colors } from '../theme/tokens';
import { GearIcon, BoltIcon, CheckIcon, BookIcon, CloseIcon, ChevronLeftIcon } from '../components/icons';
import AppBlocker from '../native/AppBlocker';
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
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  glyphBox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
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
      if (!granted) Linking.openSettings().catch(() => {});
    }
  };

  const handleHaptics = async (value: boolean) => {
    setHapticsEnabled(value);
    await savePrefs({ hapticFeedback: value });
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

  const ink = isDark ? '#f5f5f5' : colors.midnight;

  return (
    <View style={[styles.container, { backgroundColor: theme.paper }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.header, headerAnimStyle]}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.navLink} accessibilityRole="button" accessibilityLabel="Back">
              <View style={styles.backRow}>
                <ChevronLeftIcon size={18} color={ink} />
                <Text style={[typography.bodyMedium, { color: ink }]}>Back</Text>
              </View>
            </TouchableOpacity>
            <View style={{ width: 50 }} />
          </View>
          <Text style={[typography.display, { color: ink, marginTop: spacing.md }]}>SETTINGS</Text>
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
                    { backgroundColor: active ? colors.ectoGreen : 'transparent' },
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
          <View style={[styles.hairline, { backgroundColor: theme.paperBorder }]} />

          {/* Feedback */}
          <SectionHeader label="FEEDBACK" color={theme.inkSecondary} glyph={<BoltIcon size={16} color={colors.midnight} />} />
          <View style={styles.switchRow}>
            <Text style={[typography.bodyMedium, { color: ink }]}>Notifications</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotifications}
              trackColor={{ false: theme.inkFaint, true: colors.ectoGreen }}
              thumbColor={theme.paperCard}
            />
          </View>
          <View style={[styles.hairline, { backgroundColor: theme.paperBorder }]} />
          <View style={styles.switchRow}>
            <Text style={[typography.bodyMedium, { color: ink }]}>Haptics</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={handleHaptics}
              trackColor={{ false: theme.inkFaint, true: colors.ectoGreen }}
              thumbColor={theme.paperCard}
            />
          </View>
          <View style={[styles.hairline, { backgroundColor: theme.paperBorder }]} />

          {/* Subscription */}
          <SectionHeader label="SUBSCRIPTION" color={theme.inkSecondary} glyph={<CheckIcon size={16} color={colors.midnight} />} />
          {isSubscribed ? (
            <View style={[styles.proPill, { backgroundColor: colors.ectoGreen }]}>
              <Text style={[typography.label, { color: colors.midnight }]}>STAYT PRO — ACTIVE</Text>
            </View>
          ) : (
            <View style={styles.freeRow}>
              <Text style={[typography.bodyMedium, { color: ink }]}>Free plan</Text>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Paywall')}
                style={styles.upgradeButton}
              >
                <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>
                  UPGRADE
                </Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={[styles.hairline, { backgroundColor: theme.paperBorder }]} />

          {/* About — static text only */}
          <SectionHeader label="SUPPORT" color={theme.inkSecondary} glyph={<BookIcon size={16} color={colors.midnight} />} />
          <Text style={[typography.bodyMedium, { color: ink }]}>StayT</Text>
          <Text style={[typography.caption, { color: theme.inkSecondary, marginTop: spacing.xs }]}>
            v{appVersion} · SMALL STEPS. BUILD BIG PROGRESS.
          </Text>
          <View style={[styles.hairline, { backgroundColor: theme.paperBorder }]} />

          {/* Danger zone */}
          <SectionHeader label="DANGER ZONE" color={colors.danger} glyph={<CloseIcon size={16} color="#ffffff" />} />
          <TouchableOpacity activeOpacity={0.7} onPress={handleResetOnboarding} style={styles.dangerRow}>
            <Text style={[typography.bodyMedium, { color: colors.danger }]}>Reset onboarding</Text>
          </TouchableOpacity>
          <View style={[styles.hairline, { backgroundColor: theme.paperBorder }]} />
          <TouchableOpacity activeOpacity={0.7} onPress={handleClearHistory} style={styles.dangerRow}>
            <Text style={[typography.bodyMedium, { color: colors.danger }]}>Clear history</Text>
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
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    minHeight: 44,
  },
  hairline: {
    height: 1,
    marginVertical: spacing.sm,
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
  dangerRow: {
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: radius.md,
  },
});
