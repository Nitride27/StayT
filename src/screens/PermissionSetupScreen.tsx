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
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
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
  const appState = useRef(AppState.currentState);
  const oemWarning = getOEMWarning();

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
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    mascotOpacity.value = withDelay(150, withTiming(1, { duration: 500, easing: Easing.out(Easing.cubic) }));
    mascotScale.value = withDelay(150, withSpring(1, { damping: 12, stiffness: 200 }));

    oemOpacity.value = withDelay(500, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    oemTranslateY.value = withDelay(500, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(600, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
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
      }
      appState.current = nextState;
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, []);

  // --- Auto-advance when accessibility is granted ---
  useEffect(() => {
    if (accessibilityEnabled) {
      const timer = setTimeout(() => {
        markOnboarded().finally(() => navigation.navigate('TaskPicker'));
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [accessibilityEnabled, navigation]);

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
    try {
      AppBlocker.openAccessibilitySettings();
    } catch {
      Alert.alert('Error', 'Could not open accessibility settings.');
    }
  };

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const secondary = isDark ? darkColors.inkSecondary : colors.inkSecondary;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View style={styles.topSection}>
        {/* Mascot */}
        <Animated.View style={[styles.mascotContainer, mascotAnimStyle]}>
          <Image
            source={mascotSource('phone', isDark)}
            style={styles.mascotImage}
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
              typography.body,
              {
                color: secondary,
                textAlign: 'center',
                marginTop: spacing.md,
              },
            ]}
          >
            StayT needs Accessibility permission to check which app is open, so it can block distractions while you work.
          </Text>
        </Animated.View>

        {/* OEM warning */}
        {oemWarning && (
          <Animated.View style={[styles.oemLine, oemAnimStyle]}>
            <Text
              style={[
                typography.caption,
                { color: muted, textAlign: 'center' },
              ]}
            >
              {oemWarning}
            </Text>
          </Animated.View>
        )}
      </View>

      {/* Bottom section */}
      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={handleGrantAccessibility}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={styles.primaryButtonText}>OPEN SETTINGS</Text>
        </AnimatedTouchable>
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
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  mascotContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  mascotImage: {
    width: 180,
    height: 180,
  },
  oemLine: {
    paddingHorizontal: spacing.lg,
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
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.midnight,
    textAlign: 'center',
  },
});
