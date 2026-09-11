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
import { SwitchArrowsIcon } from '../components/icons';
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
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    timerOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    timerScale.value = withDelay(250, withSpring(1, { damping: 16, stiffness: 200 }));

    buttonOpacity.value = withDelay(550, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
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
    try {
      await store.saveSession({ ...session, status: 'completed', endedAt: Date.now(), duration: Date.now() - session.startedAt });
    } finally {
      // Blocking must release even if the save failed — never trap the user.
      await AppBlocker.stopBlocking().catch(() => {});
      navigation.navigate('TaskPicker');
    }
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
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const endBg = isDark ? '#1a1a1a' : colors.midnight;
  const endText = '#ffffff';

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <Image source={mascotSource('working', isDark)} style={styles.mascotImage} resizeMode="contain" />
        <Text style={[typography.display, { color: ink, textAlign: 'center', marginTop: spacing.lg }]}>
          {task.name.toUpperCase()}
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
          style={styles.switchButton}
          activeOpacity={0.85}
          onPress={handleEndSession}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <View style={styles.switchRow}>
            <SwitchArrowsIcon size={18} color={colors.midnight} />
            <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>SWITCH TASK</Text>
          </View>
        </AnimatedTouchable>
        <TouchableOpacity activeOpacity={0.7} onPress={handleEndSession} style={[styles.endButton, { backgroundColor: endBg }]}>
          <Text style={[typography.cta, { color: endText, textAlign: 'center' }]}>
            END SESSION
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
    width: 220,
    height: 220,
  },
  timerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButton: {
    borderBottomWidth: 3,
    borderBottomColor: '#000000',
    borderRadius: radius.xl,
    paddingVertical: 18,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  bottomSection: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  switchButton: {
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
