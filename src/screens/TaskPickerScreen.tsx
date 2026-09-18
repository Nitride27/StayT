import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
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
import { useOnForeground } from '../hooks/useOnForeground';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task, blockedPackagesOf } from '../types';
import AppBlocker from '../native/AppBlocker';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { TaskGlyph, ChevronRightIcon, GearIcon, PlusIcon, FlameIcon, ClockIcon } from '../components/icons';
import { FREE_TASK_LIMIT } from './PaywallScreen';
import { tap } from '../haptics';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskPicker'>;
  route: { params?: { autoStartTaskId?: string } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function TaskCardContent({ task, isDark, onSelect, onEditTask }: { task: Task; isDark: boolean; onSelect: (t: Task) => void; onEditTask: (t: Task) => void }) {
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const pkgs = blockedPackagesOf(task);
  const subtitle = pkgs.length > 1 ? `${task.appName} +${pkgs.length - 1} more` : task.appName;

  return (
    <>
      <TaskGlyph name={task.name} size={34} color={ink} />
      <View style={styles.taskInfo}>
        <Text style={[typography.h3, { color: ink }]} numberOfLines={1}>{task.name.toUpperCase()}</Text>
        <Text style={[typography.caption, { color: muted }]} numberOfLines={1}>{subtitle}</Text>
      </View>
      <TouchableOpacity onPress={() => onEditTask(task)} activeOpacity={0.7} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={`Edit ${task.name}`} style={styles.editHit}>
        <ChevronRightIcon size={20} color={muted} />
      </TouchableOpacity>
    </>
  );
}

function TaskCardPressable({ task, isDark, onSelect, onEditTask, animStyle }: { task: Task; isDark: boolean; onSelect: (t: Task) => void; onEditTask: (t: Task) => void; animStyle?: object }) {
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const cardBorder = isDark ? darkColors.ink : colors.ink;

  return (
    <AnimatedTouchable
      style={[styles.taskCard, animStyle, { backgroundColor: cardBg, borderColor: cardBorder }]}
      activeOpacity={0.85}
      onPress={() => onSelect(task)}
    >
      <TaskCardContent task={task} isDark={isDark} onSelect={onSelect} onEditTask={onEditTask} />
    </AnimatedTouchable>
  );
}

function AnimatedTaskCard({ task, index, isDark, onSelect, onEditTask }: { task: Task; index: number; isDark: boolean; onSelect: (t: Task) => void; onEditTask: (t: Task) => void }) {
  const delay = 300 + index * 50;
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(15);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <TaskCardPressable task={task} isDark={isDark} onSelect={onSelect} onEditTask={onEditTask} animStyle={animStyle} />;
}

// Cards past the first screenful skip the entry stagger: per-card delays
// over a long task list pile up scheduled animations and jank scrolling.
const TaskCard = React.memo(function TaskCard({ task, index, isDark, onSelect, onEditTask }: { task: Task; index: number; isDark: boolean; onSelect: (t: Task) => void; onEditTask: (t: Task) => void }) {
  if (index >= 10) {
    return <TaskCardPressable task={task} isDark={isDark} onSelect={onSelect} onEditTask={onEditTask} />;
  }
  return <AnimatedTaskCard task={task} index={index} isDark={isDark} onSelect={onSelect} onEditTask={onEditTask} />;
});

export default function TaskPickerScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [streak, setStreak] = useState(0);
  const [showPaywall, setShowPaywall] = useState(false);
  // Guards the gated-tap resume below against double-fire on re-focus.
  const autoStarting = React.useRef(false);
  // Orders overlapping store reloads (focus + foreground can fire together).
  const loadVersion = React.useRef(0);

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const listOpacity = useSharedValue(0);
  const listTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  // Snap entry values to their end state: backgrounding mid-entry (or a
  // blur under a pushed screen) must never paint a frozen half-state on
  // return. Mount effect below owns the forward run; this owns blur + return.
  const snapEntries = useCallback(() => {
    headerOpacity.value = 1;
    headerTranslateY.value = 0;
    listOpacity.value = 1;
    listTranslateY.value = 0;
    buttonOpacity.value = 1;
  }, [headerOpacity, headerTranslateY, listOpacity, listTranslateY, buttonOpacity]);

  const loadData = useCallback(async () => {
    const v = ++loadVersion.current;
    try {
      const allTasks = await store.getTasks();
      if (v !== loadVersion.current) return;
      setTasks(allTasks);
      const currentStreak = await store.getStreak();
      if (v !== loadVersion.current) return;
      setStreak(currentStreak);
      const prefs = await store.getPreferences();
      if (v !== loadVersion.current) return;
      // M6: presets never counted toward the free task limit.
      const userTasks = allTasks.filter(t => !t.isPreset).length;
      setShowPaywall(prefs.isSubscribed !== true && userTasks >= FREE_TASK_LIMIT);
    } catch {
      if (v === loadVersion.current) setTasks([]);
    }
  }, []);

  // Reload on focus: goBack()/navigate() would otherwise show stale lists.
  // Version-guarded inside loadData so overlapping focus + foreground
  // refreshes resolve in order and a stale winner never paints.
  useFocusEffect(
    useCallback(() => {
      loadData().catch(() => {});
    }, [loadData]),
  );

  // Foreground return (home/recents — focus never changes there): refresh
  // the list and snap entries so the return paint is never stale or frozen.
  // Blur tail shares the snap so a pushed-over screen can't leave mid-state.
  useOnForeground(() => {
    snapEntries();
    loadData().catch(() => {});
  });
  useFocusEffect(
    useCallback(() => {
      return () => {
        snapEntries();
      };
    }, [snapEntries]),
  );

  // Resume a permission-gated tap: handleSelectTask sends the user to
  // PermissionSetup with pendingTaskId, which comes back here as
  // autoStartTaskId. Param is consumed first so a re-focus can't double-start.
  useFocusEffect(
    useCallback(() => {
      const pendingId = route.params?.autoStartTaskId;
      if (!pendingId || autoStarting.current) return;
      autoStarting.current = true;
      navigation.setParams({ autoStartTaskId: undefined });
      (async () => {
        try {
          const granted = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
          // Backed out or revoked — drop the intent rather than looping
          // back into the permission flow.
          if (!granted) return;
          const all = await store.getTasks();
          const task = all.find(t => t.id === pendingId);
          if (task) await startSessionForTask(task);
        } finally {
          autoStarting.current = false;
        }
      })().catch(() => {
        autoStarting.current = false;
      });
    }, [route.params?.autoStartTaskId]),
  );

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    listOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    listTranslateY.value = withDelay(250, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(400, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const startSessionForTask = useCallback(async (task: Task) => {
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
    // reset (not navigate): navigate() pushes a duplicate ActiveSession when
    // one is already buried in the stack (SWITCH TASK flow), and a later
    // system BACK resurrects the stale instance — old task name, dead timer,
    // blocking already stopped. Reset unmounts the buried screens (their
    // cleanup releases blocking) and mounts exactly one fresh session.
    navigation.reset({
      index: 1,
      routes: [{ name: 'TaskPicker' }, { name: 'ActiveSession', params: { task, session } }],
    });
  }, [navigation]);

  const handleSelectTask = useCallback(async (task: Task) => {
    tap();
    // No service = no blocking and no blocked screen. Route to the
    // permission flow instead of starting a silently unprotected session —
    // the task id rides along so granting resumes this exact tap.
    const granted = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
    if (!granted) {
      navigation.navigate('PermissionSetup', { pendingTaskId: task.id });
      return;
    }
    await startSessionForTask(task);
  }, [navigation, startSessionForTask]);

  const handleEditTask = useCallback((task: Task) => {
    navigation.navigate('TaskSetup', { task });
  }, [navigation]);

  const handleAddTask = () => {
    tap();
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
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.navigate('History')}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            style={[styles.streakPill, styles.clockBox]}
            accessibilityRole="button"
            accessibilityLabel="View history"
          >
            <ClockIcon size={20} color={colors.midnight} strokeWidth={3.5} />
          </TouchableOpacity>
          <View style={styles.headerRight}>
            <View
              style={styles.streakPill}
              accessibilityRole="text"
              accessibilityLabel={`${streak} day streak`}
            >
            <FlameIcon size={16} color={colors.midnight} />
            <Text style={[styles.streakCount]}>{streak}</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('Settings')} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} style={[styles.gearButton, { borderColor: ink }]} accessibilityRole="button" accessibilityLabel="Settings">
              <GearIcon size={22} color={ink} />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={[typography.display, { color: ink, marginTop: spacing.lg }]}>
          WHAT ARE YOU DOING?
        </Text>
      </Animated.View>

      <Animated.View style={[styles.listWrap, listAnimStyle]}>
        {tasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Image source={mascotSource('peeking', isDark)} style={styles.emptyImage} resizeMode="contain" />
            <Text style={[typography.bodyStrong, { color: muted, textAlign: 'center', maxWidth: 280, alignSelf: 'center' }]}>
              No tasks yet.
            </Text>
            <Text style={[typography.caption, { color: muted, textAlign: 'center', maxWidth: 280, alignSelf: 'center' }]}>
              Tap NEW TASK below to block your first app.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.listScroll}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {tasks.map((task, index) => (
              <TaskCard key={task.id} task={task} index={index} isDark={isDark} onSelect={handleSelectTask} onEditTask={handleEditTask} />
            ))}
          </ScrollView>
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
          <View style={styles.primaryButtonRow}>
            <PlusIcon size={18} color={colors.midnight} />
            <Text style={styles.primaryButtonText}>
              {showPaywall ? 'ADD TASK (UPGRADE)' : 'NEW TASK'}
            </Text>
          </View>
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
    minWidth: 38,
    minHeight: 44,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 2,
    borderBottomColor: colors.ectoGreenDark,
    minHeight: 44,
  },
  streakCount: {
    ...typography.cta,
    color: colors.midnight,
  },
  clockBox: {
    marginTop: 4,
    minHeight: 46,
  },
  streakFlame: {
    width: 20,
    height: 20,
  },
  listWrap: {
    flex: 1,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    gap: spacing.md,
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
    width: 130,
    height: 130,
  },
  bottomSection: {
    paddingTop: spacing.lg,
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
  primaryButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryButtonText: {
    ...typography.cta,
    color: colors.midnight,
    textAlign: 'center',
  },
});
