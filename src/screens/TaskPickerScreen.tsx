import React, { useState, useEffect, useCallback } from 'react';
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
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, gamification, layout, colors } from '../theme/tokens';
import { FREE_TASK_LIMIT } from './PaywallScreen';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskPicker'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function TaskCard({ task, index, isDark, onPress }: { task: Task; index: number; isDark: boolean; onPress: () => void }) {
  const delay = 300 + index * 50;
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(15);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <AnimatedTouchable
      style={[styles.taskCard, animStyle, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={styles.taskInfo}>
        <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>{task.name}</Text>
        <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>
          {task.blockedPackages && task.blockedPackages.length > 1
            ? `${task.blockedPackages.length} apps blocked`
            : task.packageName}
        </Text>
      </View>
      <View style={styles.taskAction}>
        <View style={[styles.playDot, { backgroundColor: colors.ectoGreen }]} />
      </View>
    </AnimatedTouchable>
  );
}

export default function TaskPickerScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [streak, setStreak] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const listOpacity = useSharedValue(0);
  const listTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  // Reload on focus: goBack()/navigate() would otherwise show stale lists.
  useFocusEffect(
    useCallback(() => {
      loadData().catch(() => {});
    }, []),
  );

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    listOpacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    listTranslateY.value = withDelay(250, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const loadData = async () => {
    try {
      const allTasks = await store.getTasks();
      setTasks(allTasks);
      const currentStreak = await store.getStreak();
      setStreak(currentStreak);
      const prefs = await store.getPreferences();
      const userTasks = allTasks.filter(t => !t.isPreset).length;
      setShowPaywall(prefs.isSubscribed !== true && userTasks >= FREE_TASK_LIMIT);
    } catch {
      setTasks([]);
    }
  };

  const handleSelectTask = async (task: Task) => {
    // Supersede any zombie active session (e.g. process kill) before starting new.
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
      // Best-effort; a stale session must not block starting a new one.
    }
    const session = {
      id: `session-${Date.now()}`,
      taskId: task.id,
      startedAt: Date.now(),
      endedAt: null,
      duration: null,
      status: 'active' as const,
    };
    await store.saveSession(session);
    navigation.navigate('ActiveSession', { task, session });
  };

  const handleAddTask = () => {
    if (showPaywall) {
      navigation.navigate('Paywall');
    } else {
      navigation.navigate('TaskSetup', {});
    }
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const listAnimStyle = useAnimatedStyle(() => ({
    opacity: listOpacity.value,
    transform: [{ translateY: listTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000000' : colors.paper }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.navigate('History')} activeOpacity={0.7}>
            <Text style={[typography.bodyMedium, { color: colors.macawBlue }]}>History</Text>
          </TouchableOpacity>
          <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight }]}>Tasks</Text>
          <View style={{ width: 50 }} />
        </View>
        {streak > 0 && (
          <View style={styles.streakBadge}>
            <View style={[styles.streakDot, { backgroundColor: colors.fire }]} />
            <Text style={[typography.bodyMedium, { color: colors.fire, fontWeight: '600' }]}>{streak} day streak</Text>
          </View>
        )}
      </Animated.View>

      <Animated.View style={[styles.list, listAnimStyle]}>
        {tasks.map((task, index) => (
          <TaskCard key={task.id} task={task} index={index} isDark={isDark} onPress={() => handleSelectTask(task)} />
        ))}
      </Animated.View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, buttonStyle]}
          activeOpacity={0.85}
          onPress={handleAddTask}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={styles.primaryButtonText}>
            {showPaywall ? 'Add Task (Upgrade)' : 'Add New Task'}
          </Text>
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
    marginBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  streakDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  list: {
    flex: 1,
    gap: spacing.md,
  },
  taskCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  taskInfo: {
    flex: 1,
  },
  taskAction: {
    marginLeft: spacing.md,
  },
  playDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  bottomSection: {
    paddingTop: spacing.lg,
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
