import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
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
import { store } from '../storage/store';
import { Session, Task, blockedPackagesOf } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
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

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const timerOpacity = useSharedValue(0);
  const timerScale = useSharedValue(0.9);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    timerOpacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    timerScale.value = withDelay(250, withSpring(1, { damping: 12, stiffness: 200 }));

    buttonOpacity.value = withDelay(550, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
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

  // Start blocking when session begins; always release on unmount
  // so a gesture-back can't leave blocking on with no session.
  useEffect(() => {
    AppBlocker.startBlocking(blockedPackagesOf(task)).catch(() => {});
    return () => {
      AppBlocker.stopBlocking().catch(() => {});
    };
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

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <Image source={mascotSource('working', isDark)} style={styles.mascotImage} resizeMode="contain" />
        <Text style={[typography.display, { color: ink, textAlign: 'center', marginTop: spacing.lg }]}>
          {task.name}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.timerArea, timerAnimStyle]}>
        <Text style={[typography.timerXL, { color: ink }]}>
          {formatElapsed(elapsed)}
        </Text>
        <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
          Small steps build big progress.
        </Text>
      </Animated.View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.switchButton, { borderColor: colors.ectoGreen }]}
          activeOpacity={0.85}
          onPress={handleEndSession}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={[typography.button, { color: colors.ectoGreen, textAlign: 'center' }]}>SWITCH TASK</Text>
        </AnimatedTouchable>
        <TouchableOpacity activeOpacity={0.7} onPress={handleEndSession} style={[styles.endButton, { borderColor: colors.ectoGreen }]}>
          <Text style={[typography.button, { color: colors.ectoGreen, textAlign: 'center' }]}>
            End session
          </Text>
        </TouchableOpacity>
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
  },
  mascotImage: {
    width: 180,
    height: 180,
  },
  timerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  bottomSection: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  switchButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
