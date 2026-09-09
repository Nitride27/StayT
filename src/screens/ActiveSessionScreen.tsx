import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task, Session } from '../types';
import AppBlocker from '../native/AppBlocker';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, buttons, gamification, layout } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveSession'>;
  route: {
    params: {
      task: Task;
      session: Session;
    };
  };
};

export default function ActiveSessionScreen({ navigation, route }: Props) {
  const { task, session } = route.params;
  const { colors } = useTheme();
  const [elapsed, setElapsed] = useState(0);
  const [streak, setStreak] = useState(task.streak);
  const [serviceAlive, setServiceAlive] = useState(true);
  const checkRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const startTime = session.startedAt;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [session.startedAt]);

  useEffect(() => {
    checkRef.current = setInterval(async () => {
      const enabled = await AppBlocker.isAccessibilityServiceEnabled();
      setServiceAlive(enabled);
    }, 5000);
    return () => { if (checkRef.current) clearInterval(checkRef.current); };
  }, []);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndTask = async () => {
    await AppBlocker.stopBlocking();
    const updatedSession: Session = {
      ...session,
      endedAt: Date.now(),
      duration: Date.now() - session.startedAt,
      status: 'completed',
    };
    await store.saveSession(updatedSession);

    const updatedTask: Task = {
      ...task,
      lastUsed: Date.now(),
      useCount: task.useCount + 1,
      isActive: false,
    };
    await store.saveTask(updatedTask);

    navigation.navigate('TaskPicker');
  };

  const handleSwitchTask = async () => {
    await AppBlocker.stopBlocking();
    const updatedSession: Session = {
      ...session,
      endedAt: Date.now(),
      duration: Date.now() - session.startedAt,
      status: 'cancelled',
    };
    await store.saveSession(updatedSession);
    navigation.navigate('TaskPicker');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.paper }]}>
      <View style={[styles.header, { paddingTop: layout.headerPaddingTop, paddingHorizontal: layout.screenPaddingH, paddingBottom: layout.headerPaddingBottom }]}>
        <Text style={[typography.h1, { color: colors.ink }]}>{task.name}</Text>
        <Text style={[typography.body, { color: colors.inkMuted, marginTop: spacing.xs }]}>Blocking: {task.appName}</Text>
      </View>

      <View style={styles.timerContainer}>
        <Text style={[typography.timer, { color: colors.ectoGreen }]}>{formatTime(elapsed)}</Text>
        <Text style={[typography.body, { color: colors.inkMuted, marginTop: spacing.sm }]}>Time focused</Text>
      </View>

      {streak > 0 && (
        <View style={styles.streakContainer}>
          <View style={[styles.streakBadge, { backgroundColor: colors.paperCard }]}>
            <Text style={{ fontSize: gamification.streak.fireSize }}>🔥</Text>
            <Text style={[gamification.streak.numberFont, { color: colors.fire }]}>{streak}</Text>
            <Text style={[typography.caption, { color: colors.inkMuted }]}>
              {streak === 1 ? 'day' : 'days'} streak
            </Text>
          </View>
        </View>
      )}

      {!serviceAlive && (
        <View style={[styles.warningBanner, { backgroundColor: colors.fireDark || colors.paperCard, marginHorizontal: layout.screenPaddingH }]}>
          <Text style={[typography.bodyMedium, { color: colors.midnight || colors.ink, textAlign: 'center', fontWeight: '600' }]}>⚠️ Blocking paused</Text>
          <Text style={[typography.caption, { color: colors.midnight || colors.ink, textAlign: 'center', marginTop: spacing.xs }]}>
            Accessibility service was disabled. Apps are no longer blocked.
          </Text>
          <TouchableOpacity
            style={[styles.warningButton, { backgroundColor: colors.ectoGreen, borderRadius: radius.md }]}
            activeOpacity={0.8}
            onPress={() => AppBlocker.openAccessibilitySettings()}
          >
            <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>Re-enable Service</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.buttonArea, { paddingHorizontal: layout.screenPaddingH, paddingBottom: layout.safeAreaBottom }]}>
        <TouchableOpacity
          style={[
            styles.endButton,
            { backgroundColor: colors.ectoGreen, borderBottomWidth: 3, borderBottomColor: colors.eelDarkBlue, borderRadius: radius.md },
          ]}
          activeOpacity={0.8}
          onPress={handleEndTask}
        >
          <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>End Task</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.switchButton,
            { backgroundColor: colors.paperCard, borderRadius: radius.md, borderWidth: 2, borderColor: colors.paperBorder },
          ]}
          activeOpacity={0.8}
          onPress={handleSwitchTask}
        >
          <Text style={[typography.label, { color: colors.inkSecondary, textAlign: 'center' }]}>Switch Task</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  timerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  warningBanner: {
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  warningButton: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
  },
  buttonArea: {
    gap: spacing.md,
  },
  endButton: {
    paddingVertical: spacing.lg,
  },
  switchButton: {
    paddingVertical: spacing.lg,
  },
});
