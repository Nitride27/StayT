import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task } from '../types';
import AppBlocker from '../native/AppBlocker';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, buttons, gamification, shadows, layout } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskPicker'>;
};

export default function TaskPickerScreen({ navigation }: Props) {
  const { colors: themeColors } = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);
  const [streak, setStreak] = useState(0);
  const [pressedButton, setPressedButton] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const loadedTasks = await store.getTasks();
    setTasks(loadedTasks);
    const enabled = await AppBlocker.isAccessibilityServiceEnabled();
    setAccessibilityEnabled(enabled);
    const currentStreak = await store.getStreak();
    setStreak(currentStreak);
  };

  const handleNewTask = async () => {
    const prefs = await store.getPreferences();
    if (!prefs.isSubscribed && tasks.length >= prefs.freeTaskLimit) {
      navigation.navigate('Paywall');
      return;
    }
    navigation.navigate('TaskSetup', {});
  };

  const handleTaskPress = async (task: Task) => {
    if (!accessibilityEnabled) {
      navigation.navigate('PermissionSetup');
      return;
    }

    const session = {
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      taskId: task.id,
      startedAt: Date.now(),
      endedAt: null,
      duration: null,
      status: 'active' as const,
    };

    await store.saveSession(session);
    await AppBlocker.startBlocking([task.packageName]);
    navigation.navigate('ActiveSession', { task, session });
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.paper }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.title, { color: themeColors.ink }]}>StayT</Text>
            <Text style={[styles.subtitle, { color: themeColors.inkSecondary }]}>
              Task-aware app blocker
            </Text>
          </View>
          {streak > 0 && (
            <View style={[styles.streakBadge, { backgroundColor: themeColors.paperCard, borderColor: themeColors.paperBorder }]}>
              <Text style={styles.streakFire}>{gamification.streak.fireSize > 0 ? '🔥' : ''}</Text>
              <Text style={[styles.streakNumber, { color: themeColors.ectoGreen }]}>{streak}</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.taskList} contentContainerStyle={styles.taskListContent}>
        {tasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyIcon, { color: themeColors.inkFaint }]}>📋</Text>
            <Text style={[styles.emptyText, { color: themeColors.ink }]}>No tasks yet</Text>
            <Text style={[styles.emptySubtext, { color: themeColors.inkMuted }]}>
              Create your first task to start blocking distracting apps
            </Text>
          </View>
        ) : (
          tasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={[
                styles.taskItem,
                { backgroundColor: themeColors.paperCard, borderColor: themeColors.paperBorder },
              ]}
              onPress={() => handleTaskPress(task)}
              activeOpacity={0.7}
            >
              <View style={styles.taskInfo}>
                <Text style={[styles.taskName, { color: themeColors.ink }]}>{task.name}</Text>
                <Text style={[styles.taskApp, { color: themeColors.inkMuted }]}>{task.appName}</Text>
              </View>
              <View style={styles.taskMeta}>
                {task.streak > 0 && (
                  <View style={styles.streakRow}>
                    <Text style={styles.streakEmoji}>🔥</Text>
                    <Text style={[styles.streakValue, { color: themeColors.ectoGreen }]}>{task.streak}</Text>
                  </View>
                )}
                <Text style={[styles.useCount, { color: themeColors.inkFaint }]}>×{task.useCount}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.addButton,
          pressedButton === 'new' ? buttons.primaryPressed : buttons.primary,
        ]}
        onPress={handleNewTask}
        onPressIn={() => setPressedButton('new')}
        onPressOut={() => setPressedButton(null)}
        activeOpacity={0.9}
      >
        <Text style={[styles.addButtonText, { color: themeColors.eelDarkBlue }]}>+ New Task</Text>
      </TouchableOpacity>

      {!accessibilityEnabled && (
        <TouchableOpacity
          style={[styles.permissionBanner, { backgroundColor: themeColors.permissionBanner, borderTopColor: themeColors.paperBorder }]}
          onPress={() => navigation.navigate('PermissionSetup')}
          activeOpacity={0.7}
        >
          <Text style={[styles.permissionText, { color: themeColors.permissionBannerText }]}>
            ⚠️ Enable Accessibility Service
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: layout.headerPaddingTop,
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: layout.headerPaddingBottom,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    ...typography.h1,
  },
  subtitle: {
    ...typography.body,
    marginTop: spacing.xs,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 2,
  },
  streakFire: {
    fontSize: 20,
    marginRight: spacing.xs,
  },
  streakNumber: {
    ...gamification.streak.numberFont,
    fontSize: 24,
  },
  taskList: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  taskListContent: {
    paddingBottom: spacing.xl,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.lg,
  },
  emptyText: {
    ...typography.h2,
  },
  emptySubtext: {
    ...typography.body,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  taskItem: {
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 2,
    ...shadows.card,
  },
  taskInfo: {
    flex: 1,
  },
  taskName: {
    ...typography.bodyBold,
  },
  taskApp: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  taskMeta: {
    alignItems: 'flex-end',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  streakEmoji: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  streakValue: {
    ...typography.bodyBold,
  },
  useCount: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  addButton: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
  },
  addButtonText: {
    ...typography.label,
    textAlign: 'center',
  },
  permissionBanner: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 2,
  },
  permissionText: {
    ...typography.bodyMedium,
    textAlign: 'center',
  },
});
