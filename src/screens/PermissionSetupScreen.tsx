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
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import AppBlocker from '../native/AppBlocker';
import { store } from '../storage/store';
import { Platform } from 'react-native';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PermissionSetup'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function getOEMWarning(): string | null {
  if (Platform.OS !== 'android') return null;
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer =
    (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  if (manufacturer.includes('xiaomi') || model.includes('xiaomi'))
    return 'Xiaomi: Settings > Apps > Manage apps > StayT > Autostart';
  if (manufacturer.includes('samsung') || model.includes('samsung'))
    return 'Samsung: Settings > Battery > StayT > Allow background activity';
  if (manufacturer.includes('huawei') || model.includes('huawei'))
    return 'Huawei: Settings > Battery > App launch > StayT > Manage manually';
  return null;
}

export default function PermissionSetupScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(false);
  const [notificationRequested, setNotificationRequested] = useState(false);
  const appState = useRef(AppState.currentState);
  const oemWarning = getOEMWarning();

  // --- Animations ---
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const mascotScale = useSharedValue(0.8);
  const mascotOpacity = useSharedValue(0);
  const card1Opacity = useSharedValue(0);
  const card1TranslateY = useSharedValue(20);
  const card2Opacity = useSharedValue(0);
  const card2TranslateY = useSharedValue(20);
  const oemOpacity = useSharedValue(0);
  const oemTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);
  const checkDotScale = useSharedValue(1);

  // Success pulse shared values for each card
  const accDotScale = useSharedValue(1);
  const notifDotScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    mascotOpacity.value = withDelay(150, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    mascotScale.value = withDelay(150, withSpring(1, { damping: 12, stiffness: 200 }));

    card1Opacity.value = withDelay(300, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    card1TranslateY.value = withDelay(300, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    card2Opacity.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    card2TranslateY.value = withDelay(400, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    oemOpacity.value = withDelay(500, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    oemTranslateY.value = withDelay(500, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(600, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  // --- Check both permissions on mount ---
  useEffect(() => {
    const checkPermissions = async () => {
      const [acc, notif] = await Promise.all([
        AppBlocker.isAccessibilityServiceEnabled(),
        AppBlocker.isNotificationPermissionGranted(),
      ]);
      setAccessibilityEnabled(acc);
      setNotificationEnabled(notif);
      setNotificationRequested(true);
    };
    checkPermissions();
  }, []);

  // --- Request notification permission once on mount (after initial check) ---
  useEffect(() => {
    if (!notificationRequested) return;
    if (notificationEnabled) return;

    const requestNotif = async () => {
      const granted = await AppBlocker.requestNotificationPermission();
      setNotificationEnabled(granted);
    };
    requestNotif();
  }, [notificationRequested, notificationEnabled]);

  // --- AppState listener: re-check accessibility when returning from settings ---
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        const acc = await AppBlocker.isAccessibilityServiceEnabled();
        setAccessibilityEnabled(acc);
      }
      appState.current = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // --- Auto-advance when accessibility is granted (notifications optional) ---
  useEffect(() => {
    if (accessibilityEnabled) {
      const timer = setTimeout(() => {
        markOnboarded().finally(() => navigation.navigate('TaskPicker'));
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [accessibilityEnabled, notificationEnabled, navigation]);

  // --- Pulse dot on grant ---
  useEffect(() => {
    if (accessibilityEnabled) {
      accDotScale.value = withSequence(
        withSpring(1.6, { damping: 8, stiffness: 300 }),
        withSpring(1, { damping: 10, stiffness: 200 })
      );
    }
  }, [accessibilityEnabled]);

  useEffect(() => {
    if (notificationEnabled) {
      notifDotScale.value = withSequence(
        withSpring(1.6, { damping: 8, stiffness: 300 }),
        withSpring(1, { damping: 10, stiffness: 200 })
      );
    }
  }, [notificationEnabled]);

  // --- Animated styles ---
  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const mascotAnimStyle = useAnimatedStyle(() => ({
    opacity: mascotOpacity.value,
    transform: [{ scale: mascotScale.value }],
  }));

  const card1AnimStyle = useAnimatedStyle(() => ({
    opacity: card1Opacity.value,
    transform: [{ translateY: card1TranslateY.value }],
  }));

  const card2AnimStyle = useAnimatedStyle(() => ({
    opacity: card2Opacity.value,
    transform: [{ translateY: card2TranslateY.value }],
  }));

  const oemAnimStyle = useAnimatedStyle(() => ({
    opacity: oemOpacity.value,
    transform: [{ translateY: oemTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const accDotAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: accDotScale.value }],
  }));

  const notifDotAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: notifDotScale.value }],
  }));

  // Notifications are optional: Continue requires accessibility only.
  const canContinue = accessibilityEnabled;

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

  // --- Handlers ---
  const handleGrantAccessibility = async () => {
    try {
      AppBlocker.openAccessibilitySettings();
    } catch {
      Alert.alert('Error', 'Could not open accessibility settings.');
    }
  };

  const handleGrantNotification = async () => {
    const granted = await AppBlocker.requestNotificationPermission();
    setNotificationEnabled(granted);
  };

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handleContinue = () => {
    if (canContinue) {
      markOnboarded().finally(() => navigation.navigate('TaskPicker'));
    }
  };

  // --- Step indicator ---
  const step1Color = accessibilityEnabled ? colors.ectoGreen : colors.inkMuted;
  const step2Color = notificationEnabled ? colors.ectoGreen : colors.inkMuted;

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000000' : colors.paper }]}>
      <View style={styles.topSection}>
        {/* Step indicator */}
        <Animated.View style={[styles.stepIndicator, headerAnimStyle]}>
          <View style={styles.stepRow}>
            <View style={[styles.stepDot, { backgroundColor: step1Color }]} />
            <View style={[styles.stepLine, { backgroundColor: accessibilityEnabled ? colors.ectoGreen : colors.inkFaint }]} />
            <View style={[styles.stepDot, { backgroundColor: step2Color }]} />
          </View>
        </Animated.View>

        {/* Header */}
        <Animated.View style={[styles.header, headerAnimStyle]}>
          <Text
            style={[
              typography.h1,
              { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center' },
            ]}
          >
            Grant Permissions
          </Text>
          <Text
            style={[
              typography.bodyMedium,
              {
                color: isDark ? colors.inkMuted : colors.inkSecondary,
                textAlign: 'center',
                marginTop: spacing.sm,
              },
            ]}
          >
            StayT needs a couple of permissions to protect your focus
          </Text>
        </Animated.View>

        {/* Mascot */}
        <Animated.View style={[styles.mascotContainer, mascotAnimStyle]}>
          <Image
            source={mascotSource('phone', isDark)}
            style={styles.mascotImage}
            resizeMode="contain"
          />
        </Animated.View>

        <View style={styles.cards}>
          {/* Accessibility Service Card */}
          <Animated.View
            style={[
              styles.permissionCard,
              card1AnimStyle,
              {
                backgroundColor: isDark ? '#111111' : colors.paperCard,
                borderColor: accessibilityEnabled
                  ? colors.ectoGreen
                  : isDark
                  ? '#1a2d5e'
                  : colors.paperBorder,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <Animated.View style={accDotAnimStyle}>
                <View style={[styles.statusDot, accessibilityEnabled && styles.statusDotActive]} />
              </Animated.View>
              <Text
                style={[
                  typography.bodyBold,
                  { color: isDark ? '#f5f5f5' : colors.midnight },
                ]}
              >
                Accessibility Service
              </Text>
              {accessibilityEnabled && (
                <Text style={[styles.checkMark, { color: colors.ectoGreen }]}>+</Text>
              )}
            </View>
            <Text
              style={[
                typography.body,
                {
                  color: isDark ? colors.inkMuted : colors.inkSecondary,
                  marginTop: spacing.xs,
                },
              ]}
            >
              Detects and blocks distracting apps so you stay focused
            </Text>
            <TouchableOpacity
              style={[styles.grantButton, accessibilityEnabled && styles.grantButtonDone]}
              activeOpacity={0.8}
              onPress={handleGrantAccessibility}
              disabled={accessibilityEnabled}
            >
              <Text
                style={[
                  typography.label,
                  {
                    color: accessibilityEnabled ? colors.ectoGreen : colors.midnight,
                    textAlign: 'center',
                  },
                ]}
              >
                {accessibilityEnabled ? 'Enabled' : 'Open Settings'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Notification Permission Card */}
          <Animated.View
            style={[
              styles.permissionCard,
              card2AnimStyle,
              {
                backgroundColor: isDark ? '#111111' : colors.paperCard,
                borderColor: notificationEnabled
                  ? colors.ectoGreen
                  : isDark
                  ? '#1a2d5e'
                  : colors.paperBorder,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              <Animated.View style={notifDotAnimStyle}>
                <View style={[styles.statusDot, notificationEnabled && styles.statusDotActive]} />
              </Animated.View>
              <Text
                style={[
                  typography.bodyBold,
                  { color: isDark ? '#f5f5f5' : colors.midnight },
                ]}
              >
                Notifications
              </Text>
              {notificationEnabled && (
                <Text style={[styles.checkMark, { color: colors.ectoGreen }]}>+</Text>
              )}
            </View>
            <Text
              style={[
                typography.body,
                {
                  color: isDark ? colors.inkMuted : colors.inkSecondary,
                  marginTop: spacing.xs,
                },
              ]}
            >
              Sends you reminders and session updates
            </Text>
            {!notificationEnabled && (
              <TouchableOpacity
                style={styles.grantButton}
                activeOpacity={0.8}
                onPress={handleGrantNotification}
              >
                <Text
                  style={[
                    typography.label,
                    { color: colors.midnight, textAlign: 'center' },
                  ]}
                >
                  Allow Notifications
                </Text>
              </TouchableOpacity>
            )}
            {notificationEnabled && (
              <View style={styles.grantedBadge}>
                <Text style={[typography.label, { color: colors.ectoGreen, textAlign: 'center' }]}>
                  Granted
                </Text>
              </View>
            )}
          </Animated.View>
        </View>

        {/* OEM warning */}
        {oemWarning && (
          <Animated.View
            style={[
              styles.oemWarning,
              oemAnimStyle,
              {
                backgroundColor: isDark ? '#111111' : colors.paperCard,
                borderColor: isDark ? '#1a2d5e' : colors.paperBorder,
              },
            ]}
          >
            <Text
              style={[
                typography.caption,
                { color: colors.fire, marginBottom: spacing.xs, fontWeight: '600' },
              ]}
            >
              Device-specific setting
            </Text>
            <Text
              style={[
                typography.body,
                { color: isDark ? colors.inkMuted : colors.inkSecondary },
              ]}
            >
              {oemWarning}
            </Text>
          </Animated.View>
        )}
      </View>

      {/* Bottom section */}
      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        {canContinue ? (
          <View style={styles.successMessage}>
            <Text
              style={[
                typography.bodyMedium,
                { color: colors.ectoGreen, textAlign: 'center' },
              ]}
            >
              All set. Taking you to your tasks...
            </Text>
          </View>
        ) : (
          <AnimatedTouchable
            style={[
              styles.primaryButton,
              { opacity: canContinue ? 1 : 0.5 },
            ]}
            activeOpacity={0.85}
            onPress={handleContinue}
            disabled={!canContinue}
            onPressIn={canContinue ? handlePressIn : undefined}
            onPressOut={canContinue ? handlePressOut : undefined}
          >
            <Text style={styles.primaryButtonText}>Continue</Text>
          </AnimatedTouchable>
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
  stepIndicator: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stepLine: {
    width: 40,
    height: 2,
    marginHorizontal: spacing.sm,
    borderRadius: 1,
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
    width: 96,
    height: 96,
  },
  cards: {
    gap: spacing.lg,
  },
  permissionCard: {
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.inkMuted,
  },
  statusDotActive: {
    backgroundColor: colors.ectoGreen,
  },
  checkMark: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  grantButton: {
    marginTop: spacing.md,
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 2,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  grantButtonDone: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  grantedBadge: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  oemWarning: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  bottomSection: {
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.midnight,
    textAlign: 'center',
  },
  successMessage: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
