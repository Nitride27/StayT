import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Session, Task } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, gamification, layout, colors } from '../theme/tokens';
import AppBlocker from '../native/AppBlocker';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveSession'>;
  route: { params: { task: Task; session: Session } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ActiveSessionScreen({ navigation, route }: Props) {
  const { task, session } = route.params;
  const { isDark } = useTheme();
  const [elapsed, setElapsed] = useState(session.startedAt ? Date.now() - session.startedAt : 0);
  const [streak, setStreak] = useState(0);
  const [serviceAlive, setServiceAlive] = useState(true);

  // Timer pulse animation
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.3);

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const timerOpacity = useSharedValue(0);
  const timerScale = useSharedValue(0.9);
  const infoOpacity = useSharedValue(0);
  const infoTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    timerOpacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    timerScale.value = withDelay(250, withSpring(1, { damping: 12, stiffness: 200 }));

    infoOpacity.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    infoTranslateY.value = withDelay(400, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(550, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));

    // Pulse animation
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.15, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, []);

  // Timer tick
  useEffect(() => {
    const interval = setInterval(() => {
      if (session.startedAt) {
        setElapsed(Date.now() - session.startedAt);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  // Service alive check
  useEffect(() => {
    const checkService = async () => {
      const alive = await AppBlocker.isAccessibilityServiceEnabled();
      setServiceAlive(alive);
    };
    const interval = setInterval(checkService, 5000);
    checkService();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      const currentStreak = await store.getStreak();
      setStreak(currentStreak);
    })();
  }, []);

  const handleEndSession = async () => {
    await store.saveSession({ ...session, status: 'completed', endedAt: Date.now(), duration: Date.now() - session.startedAt });
    await AppBlocker.stopBlocking();
    navigation.navigate('TaskPicker');
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const timerAnimStyle = useAnimatedStyle(() => ({
    opacity: timerOpacity.value,
    transform: [{ scale: timerScale.value }],
  }));

  const pulseAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const infoAnimStyle = useAnimatedStyle(() => ({
    opacity: infoOpacity.value,
    transform: [{ translateY: infoTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? colors.midnight : colors.paper }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center' }]}>
          Focusing on
        </Text>
        <Text style={[typography.h1, { color: colors.ectoGreen, textAlign: 'center', marginTop: spacing.xs }]}>
          {task.name}
        </Text>
      </Animated.View>

      <View style={styles.timerArea}>
        {/* Pulse ring */}
        <Animated.View style={[styles.pulseRing, pulseAnimStyle, { backgroundColor: colors.ectoGreen }]} />

        <Animated.View style={[styles.timerCircle, timerAnimStyle, { backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}>
          <Text style={[styles.timerText, { color: isDark ? '#f5f5f5' : colors.midnight }]}>
            {formatElapsed(elapsed)}
          </Text>
          <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>
            elapsed
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.infoSection, infoAnimStyle]}>
        <View style={styles.infoRow}>
          <View style={[styles.infoCard, { backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}>
            <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>Streak</Text>
            <View style={styles.streakValue}>
              <View style={[styles.streakDot, { backgroundColor: colors.fire }]} />
              <Text style={[typography.h2, { color: colors.fire }]}>{streak}</Text>
            </View>
          </View>

          <View style={[styles.infoCard, { backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}>
            <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>Blocked</Text>
            <View style={styles.serviceStatus}>
              <View style={[styles.statusDot, { backgroundColor: serviceAlive ? colors.ectoGreen : colors.fire }]} />
              <Text style={[typography.h2, { color: serviceAlive ? colors.ectoGreen : colors.fire }]}>
                {serviceAlive ? 'Active' : 'Off'}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { backgroundColor: gamification.blockedButton.override, borderBottomColor: colors.macawBlueDark }]}
          activeOpacity={0.85}
          onPress={handleEndSession}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>End Session</Text>
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
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xxxl,
  },
  timerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  timerCircle: {
    width: 180,
    height: 180,
    borderRadius: 90,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  timerText: {
    fontSize: 40,
    fontWeight: '300',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },
  infoSection: {
    marginTop: spacing.xxl,
  },
  infoRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  infoCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: 'center',
  },
  streakValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  streakDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serviceStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bottomSection: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    borderBottomWidth: 3,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
