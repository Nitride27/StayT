import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, AppState, Alert } from 'react-native';
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
import { CheckIcon, BoltIcon, FlameIcon } from '../components/icons';
import AppBlocker, { InstalledApp } from '../native/AppBlocker';
import { store } from '../storage/store';
import { Task } from '../types';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Welcome'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function WelcomeScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  // P0-3 five-minute demo: pick 1 app -> temp task -> straight to session.
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoApps, setDemoApps] = useState<InstalledApp[]>([]);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNeedsPermission, setDemoNeedsPermission] = useState(false);
  const pendingDemo = useRef<InstalledApp | null>(null);

  // Entry animations
  const heroOpacity = useSharedValue(0);
  const heroTranslateY = useSharedValue(20);
  const feature1Opacity = useSharedValue(0);
  const feature1TranslateY = useSharedValue(20);
  const feature2Opacity = useSharedValue(0);
  const feature2TranslateY = useSharedValue(20);
  const feature3Opacity = useSharedValue(0);
  const feature3TranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonTranslateY = useSharedValue(20);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    heroOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    heroTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    feature1Opacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    feature1TranslateY.value = withDelay(250, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    feature2Opacity.value = withDelay(350, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    feature2TranslateY.value = withDelay(350, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    feature3Opacity.value = withDelay(450, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    feature3TranslateY.value = withDelay(450, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(600, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    buttonTranslateY.value = withDelay(600, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const heroAnimStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslateY.value }],
  }));

  const feature1AnimStyle = useAnimatedStyle(() => ({
    opacity: feature1Opacity.value,
    transform: [{ translateY: feature1TranslateY.value }],
  }));

  const feature2AnimStyle = useAnimatedStyle(() => ({
    opacity: feature2Opacity.value,
    transform: [{ translateY: feature2TranslateY.value }],
  }));

  const feature3AnimStyle = useAnimatedStyle(() => ({
    opacity: feature3Opacity.value,
    transform: [{ translateY: feature3TranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonTranslateY.value }, { scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  // P0-3 demo: existing installed-app row pattern; fallback to
  // YouTube/Instagram entries when the installed list is unavailable.
  const openDemoPicker = async () => {
    setDemoOpen(true);
    setDemoNeedsPermission(false);
    try {
      const apps = await AppBlocker.getInstalledApps();
      const preferred = apps.filter(a =>
        a.packageName === 'com.google.android.youtube' ||
        a.packageName === 'com.instagram.android',
      );
      setDemoApps(preferred.length > 0 ? preferred : apps.slice(0, 8));
    } catch {
      setDemoApps([
        { packageName: 'com.google.android.youtube', appName: 'YouTube' },
        { packageName: 'com.instagram.android', appName: 'Instagram' },
      ]);
    }
  };

  const startDemoSession = async (app: InstalledApp) => {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      // Zombie-session supersede, same as TaskPicker (never double-active).
      try {
        const existing = await store.getActiveSession();
        if (existing) {
          await store.saveSession({
            ...existing,
            status: 'completed',
            endedAt: Date.now(),
            duration: Date.now() - existing.startedAt,
          });
        }
      } catch {
        // Best-effort; must not block the demo.
      }
      const task: Task = {
        id: `demo-${Date.now()}`,
        name: 'Demo Focus',
        packageName: app.packageName,
        appName: app.appName,
        isDemo: true,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        useCount: 0,
        isActive: true,
        streak: 0,
      };
      await store.saveTask(task);
      const session = {
        id: `session-${Date.now()}`,
        taskId: task.id,
        startedAt: Date.now(),
        endedAt: null,
        duration: null,
        status: 'active' as const,
      };
      await store.saveSession(session);
      pendingDemo.current = null;
      setDemoNeedsPermission(false);
      navigation.navigate('ActiveSession', { task, session });
    } catch {
      Alert.alert('Could not start demo', 'Storage failed. Please try again.');
    } finally {
      setDemoBusy(false);
    }
  };

  const handlePickDemoApp = async (app: InstalledApp) => {
    // Accessibility is still required — one line of copy + the existing
    // auto-open-settings flow; resume automatically on return.
    const granted = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
    if (granted) {
      await startDemoSession(app);
      return;
    }
    pendingDemo.current = app;
    setDemoNeedsPermission(true);
    AppBlocker.openAccessibilitySettings();
  };

  // Resume a pending demo pick when returning from settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async next => {
      if (next !== 'active' || !pendingDemo.current) return;
      const granted = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
      if (granted && pendingDemo.current) {
        const app = pendingDemo.current;
        await startDemoSession(app);
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: isDark ? darkColors.paper : colors.paper }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.topSection}>
        <Animated.View style={[styles.heroArea, heroAnimStyle]}>
          {/* Mascot */}
          <Image source={mascotSource('waving', isDark)} style={styles.mascotImage} resizeMode="contain" />
          <Text style={[typography.display, { color: isDark ? darkColors.ink : colors.midnight, textAlign: 'center', marginTop: spacing.xl }]}>
            STAY FOCUSED.
          </Text>
          <Text style={[typography.display, { color: colors.ectoGreen, textAlign: 'center', marginTop: spacing.xs }]}>
            STAY ON TRACK.
          </Text>
        </Animated.View>

        <View style={styles.features}>
          <Animated.View style={[styles.featureRow, feature1AnimStyle, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <View style={styles.featureGlyph}>
              <CheckIcon size={18} color={colors.midnight} />
            </View>
            <View style={styles.featureText}>
              <Text style={[typography.bodyStrong, { color: isDark ? darkColors.ink : colors.midnight }]}>Set your focus</Text>
              <Text style={[typography.bodyStrong, { color: isDark ? darkColors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>Pick one app to block during deep work</Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.featureRow, feature2AnimStyle, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <View style={styles.featureGlyph}>
              <FlameIcon size={18} color={colors.midnight} />
            </View>
            <View style={styles.featureText}>
              <Text style={[typography.bodyStrong, { color: isDark ? darkColors.ink : colors.midnight }]}>Build your streak</Text>
              <Text style={[typography.bodyStrong, { color: isDark ? darkColors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>Each day you resist builds your streak</Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.featureRow, feature3AnimStyle, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <View style={styles.featureGlyph}>
              <BoltIcon size={18} color={colors.midnight} />
            </View>
            <View style={styles.featureText}>
              <Text style={[typography.bodyStrong, { color: isDark ? darkColors.ink : colors.midnight }]}>Stay in the zone</Text>
              <Text style={[typography.bodyStrong, { color: isDark ? darkColors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>One-tap redirect keeps you on task</Text>
            </View>
          </Animated.View>
        </View>
      </View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('PermissionSetup')}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={styles.primaryButtonText}>GET STARTED</Text>
        </AnimatedTouchable>

        <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkSecondary, textAlign: 'center', marginTop: spacing.md }]}>
          Takes 30 seconds to set up
        </Text>

        <TouchableOpacity
          activeOpacity={0.7}
          onPress={openDemoPicker}
          style={[styles.demoButton, { borderColor: isDark ? darkColors.ink : colors.ink }]}
        >
          <Text style={[typography.cta, { color: isDark ? darkColors.ink : colors.midnight, textAlign: 'center' }]}>
            TRY A 5-MIN DEMO
          </Text>
        </TouchableOpacity>

        {demoOpen && (
          <View style={[styles.demoCard, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <Text style={[typography.bodyStrong, { color: isDark ? darkColors.ink : colors.midnight, textAlign: 'center' }]}>
              Pick one app to block for 5 minutes
            </Text>
            {demoApps.map(app => (
              <TouchableOpacity
                key={app.packageName}
                activeOpacity={0.7}
                disabled={demoBusy}
                onPress={() => handlePickDemoApp(app)}
                style={styles.demoAppRow}
              >
                <Text style={[{ fontFamily: 'SpaceGrotesk-SemiBold', fontSize: 16, lineHeight: 22 }, { color: isDark ? darkColors.ink : colors.midnight }]} numberOfLines={1}>
                  {app.appName}
                </Text>
              </TouchableOpacity>
            ))}
            {demoNeedsPermission && (
              <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkSecondary, textAlign: 'center', marginTop: spacing.sm }]}>
                Demo needs the Accessibility permission so StayT can detect the app. Enable it in settings — you will return here automatically.
              </Text>
            )}
          </View>
        )}
      </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: layout.headerPaddingTop,
    paddingBottom: layout.safeAreaBottom,
  },
  topSection: {
    flex: 1,
    justifyContent: 'center',
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  mascotImage: {
    width: 220,
    height: 220,
  },
  features: {
    gap: spacing.xl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  featureGlyph: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  featureFlame: {
    width: 20,
    height: 20,
  },
  featureText: {
    flex: 1,
  },
  bottomSection: {
    marginTop: spacing.xl,
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
  demoButton: {
    borderWidth: 2,
    borderRadius: radius.xl,
    paddingVertical: 16,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  demoCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  demoAppRow: {
    paddingVertical: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
});
