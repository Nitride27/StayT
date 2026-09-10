import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
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
import { typography, spacing, radius, layout, colors } from '../theme/tokens';
import AppBlocker from '../native/AppBlocker';
import { Platform } from 'react-native';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PermissionSetup'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function getOEMWarning(): string | null {
  if (Platform.OS !== 'android') return null;
  const model = (Platform.constants?.Model as string | undefined)?.toLowerCase() ?? '';
  const manufacturer = (Platform.constants?.Manufacturer as string | undefined)?.toLowerCase() ?? '';
  if (manufacturer.includes('xiaomi') || model.includes('xiaomi')) return 'Xiaomi: Settings > Apps > Manage apps > StayT > Autostart';
  if (manufacturer.includes('samsung') || model.includes('samsung')) return 'Samsung: Settings > Battery > StayT > Allow background activity';
  if (manufacturer.includes('huawei') || model.includes('huawei')) return 'Huawei: Settings > Battery > App launch > StayT > Manage manually';
  return null;
}

export default function PermissionSetupScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const oemWarning = getOEMWarning();

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const card1Opacity = useSharedValue(0);
  const card1TranslateY = useSharedValue(20);
  const card2Opacity = useSharedValue(0);
  const card2TranslateY = useSharedValue(20);
  const oemOpacity = useSharedValue(0);
  const oemTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    card1Opacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    card1TranslateY.value = withDelay(250, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    card2Opacity.value = withDelay(350, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    card2TranslateY.value = withDelay(350, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    oemOpacity.value = withDelay(450, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    oemTranslateY.value = withDelay(450, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(550, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  // Re-check when screen is focused
  useEffect(() => {
    const check = async () => {
      const enabled = await AppBlocker.isAccessibilityServiceEnabled();
      setAccessibilityEnabled(enabled);
    };
    check();
  }, []);

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
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

  const handleGrantAccessibility = async () => {
    try {
      await AppBlocker.openAccessibilitySettings();
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

  return (
    <View style={[styles.container, { backgroundColor: isDark ? colors.midnight : colors.paper }]}>
      <View style={styles.topSection}>
        <Animated.View style={[styles.header, headerAnimStyle]}>
          <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center' }]}>
            Grant Permissions
          </Text>
          <Text style={[typography.bodyMedium, { color: isDark ? colors.inkMuted : colors.inkSecondary, textAlign: 'center', marginTop: spacing.md }]}>
            StayT needs a few permissions to work properly
          </Text>
        </Animated.View>

        <View style={styles.cards}>
          <Animated.View style={[styles.permissionCard, card1AnimStyle, { backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}>
            <View style={styles.cardHeader}>
              <View style={[styles.statusDot, accessibilityEnabled && styles.statusDotActive]} />
              <Text style={[typography.bodyBold, { color: isDark ? '#f5f5f5' : colors.midnight }]}>
                Accessibility Service
              </Text>
            </View>
            <Text style={[typography.body, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: spacing.xs }]}>
              Allows StayT to detect and block distracting apps
            </Text>
            <TouchableOpacity
              style={[styles.grantButton, accessibilityEnabled && styles.grantButtonDone]}
              activeOpacity={0.8}
              onPress={handleGrantAccessibility}
              disabled={accessibilityEnabled}
            >
              <Text style={[typography.label, { color: accessibilityEnabled ? colors.ectoGreen : colors.midnight, textAlign: 'center' }]}>
                {accessibilityEnabled ? 'Enabled' : 'Grant Access'}
              </Text>
            </TouchableOpacity>
          </Animated.View>

          <Animated.View style={[styles.permissionCard, card2AnimStyle, { backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}>
            <View style={styles.cardHeader}>
              <View style={styles.statusDot} />
              <Text style={[typography.bodyBold, { color: isDark ? '#f5f5f5' : colors.midnight }]}>
                Overlay Permission
              </Text>
            </View>
            <Text style={[typography.body, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: spacing.xs }]}>
              Required for the blocked app screen overlay
            </Text>
          </Animated.View>
        </View>

        {oemWarning && (
          <Animated.View style={[styles.oemWarning, oemAnimStyle, { backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}>
            <Text style={[typography.caption, { color: colors.fire, marginBottom: spacing.xs, fontWeight: '600' }]}>
              Device-specific setting
            </Text>
            <Text style={[typography.body, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>
              {oemWarning}
            </Text>
          </Animated.View>
        )}
      </View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: accessibilityEnabled ? 1 : 0.5 }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('TaskPicker')}
          disabled={!accessibilityEnabled}
          onPressIn={accessibilityEnabled ? handlePressIn : undefined}
          onPressOut={accessibilityEnabled ? handlePressOut : undefined}
        >
          <Text style={styles.primaryButtonText}>Continue</Text>
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
    marginBottom: spacing.xxxl,
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
    gap: spacing.md,
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
});
