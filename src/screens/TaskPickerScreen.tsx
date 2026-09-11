import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert } from 'react-native';
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
import { Task, blockedPackagesOf } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { FREE_TASK_LIMIT } from './PaywallScreen';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskPicker'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function TaskCard({ task, index, isDark, onPress, onEdit }: { task: Task; index: number; isDark: boolean; onPress: () => void; onEdit: () => void }) {
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

  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const cardBorder = isDark ? darkColors.ink : colors.ink;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const pkgs = blockedPackagesOf(task);
  const subtitle = pkgs.length > 1 ? `${task.appName} +${pkgs.length - 1} more` : task.appName;

  return (
    <AnimatedTouchable
      style={[styles.taskCard, animStyle, { backgroundColor: cardBg, borderColor: cardBorder }]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View style={styles.iconBox}>
        <Text style={[typography.button, { color: colors.midnight }]}>
          {(task.name.trim()[0] || '?').toUpperCase()}
        </Text>
      </View>
      <View style={styles.taskInfo}>
        <Text style={[typography.h3, { color: ink }]} numberOfLines={1}>{task.name}</Text>
        <Text style={[typography.caption, { color: muted }]} numberOfLines={1}>{subtitle}</Text>
      </View>
      <TouchableOpacity onPress={onEdit} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={`Edit ${task.name}`} style={styles.editHit}>
        <Text style={[typography.h2, { color: muted }]}>{'>'}</Text>
      </TouchableOpacity>
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
    try {
      await store.saveSession(session);
    } catch {
      Alert.alert('Could not start session', 'Storage failed. Please try again.');
      return;
    }
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

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const cardBorder = isDark ? darkColors.paperBorder : colors.paperBorder;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.navigate('History')} activeOpacity={0.7} style={styles.navLink}>
            <Text style={[typography.bodyMedium, { color: ink }]}>History</Text>
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <View style={[styles.streakPill, { backgroundColor: cardBg, borderColor: ink }]}>
              <Image source={require('../../assets/flame.png')} style={styles.streakFlame} resizeMode="contain" />
              <Text style={[typography.label, { color: colors.fire }]}>
                {streak > 0 ? `${streak} day streak` : 'No streak yet'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} activeOpacity={0.7} style={[styles.gearButton, { borderColor: ink }]} accessibilityRole="button" accessibilityLabel="Settings">
              <Text style={[typography.h3, { color: ink }]}>···</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={[typography.display, { color: ink, marginTop: spacing.lg }]}>
          WHAT ARE YOU DOING?
        </Text>
      </Animated.View>

      <Animated.View style={[styles.list, listAnimStyle]}>
        {tasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Image source={mascotSource('peeking', isDark)} style={styles.emptyImage} resizeMode="contain" />
            <Text style={[typography.bodyMedium, { color: muted, textAlign: 'center' }]}>
              No tasks yet. Create one to start focusing.
            </Text>
          </View>
        ) : (
          tasks.map((task, index) => (
            <TaskCard key={task.id} task={task} index={index} isDark={isDark} onPress={() => handleSelectTask(task)} onEdit={() => navigation.navigate('TaskSetup', { task })} />
          ))
        )}
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
            {showPaywall ? 'ADD TASK (UPGRADE)' : '+ NEW TASK'}
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  gearButton: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navLink: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: radius.md,
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  streakFlame: {
    width: 18,
    height: 18,
  },
  list: {
    flex: 1,
    gap: spacing.md,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    gap: spacing.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskInfo: {
    flex: 1,
  },
  editHit: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
  emptyImage: {
    width: 96,
    height: 96,
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
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButtonText: {
    ...typography.button,
    color: colors.midnight,
    textAlign: 'center',
  },
});
