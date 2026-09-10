import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Session, Task } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

type HistoryItem = Session & { taskName?: string };

function formatMs(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && now.getDate() === d.getDate()) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function SessionCard({ item, index, isDark }: { item: HistoryItem; index: number; isDark: boolean }) {
  const delay = 450 + index * 50;
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(12);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const completed = item.status === 'completed';

  return (
    <Animated.View style={[styles.sessionCard, animStyle, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}>
      <View style={styles.sessionLeft}>
        <View style={[styles.sessionDot, { backgroundColor: completed ? colors.ectoGreen : colors.fire }]} />
        <View>
          <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>{item.taskName}</Text>
          <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>{formatDate(item.startedAt)}</Text>
        </View>
      </View>
      <View style={styles.sessionRight}>
        <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>{formatMs(item.duration || 0)}</Text>
        <Text style={[typography.caption, { color: completed ? colors.ectoGreen : colors.fire, marginTop: 2, textAlign: 'right' }]}>
          {completed ? 'Completed' : 'Gave in'}
        </Text>
      </View>
    </Animated.View>
  );
}

export default function HistoryScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const [sessions, setSessions] = useState<HistoryItem[]>([]);

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const statsOpacity = useSharedValue(0);
  const statsTranslateY = useSharedValue(20);
  const listOpacity = useSharedValue(0);
  const listTranslateY = useSharedValue(20);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    statsOpacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    statsTranslateY.value = withDelay(250, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    listOpacity.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    listTranslateY.value = withDelay(400, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const loadData = async () => {
    const allSessions = await store.getSessions();
    const tasks = await store.getTasks();
    const taskMap = new Map(tasks.map((t: Task) => [t.id, t.name]));
    const withNames: HistoryItem[] = allSessions.map((s: Session) => ({
      ...s,
      taskName: taskMap.get(s.taskId) || 'Unknown',
    }));
    setSessions(withNames);
  };

  const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60000;
  const completedCount = sessions.filter((s) => s.status === 'completed').length;

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const statsAnimStyle = useAnimatedStyle(() => ({
    opacity: statsOpacity.value,
    transform: [{ translateY: statsTranslateY.value }],
  }));

  const listAnimStyle = useAnimatedStyle(() => ({
    opacity: listOpacity.value,
    transform: [{ translateY: listTranslateY.value }],
  }));

  const renderItem = ({ item, index }: { item: HistoryItem; index: number }) => (
    <SessionCard item={item} index={index} isDark={isDark} />
  );

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000000' : colors.paper }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={[typography.bodyMedium, { color: colors.macawBlue }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight }]}>History</Text>
          <View style={{ width: 50 }} />
        </View>
      </Animated.View>

      <Animated.View style={[styles.statsRow, statsAnimStyle]}>
        <View style={[styles.statCard, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}>
          <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>Sessions</Text>
          <Text style={[typography.h2, { color: isDark ? '#f5f5f5' : colors.midnight, marginTop: spacing.xs }]}>{completedCount}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}>
          <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>Focus Time</Text>
          <Text style={[typography.h2, { color: colors.ectoGreen, marginTop: spacing.xs }]}>{Math.round(totalMinutes)}m</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.listSection, listAnimStyle]}>
        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={[typography.bodyMedium, { color: isDark ? colors.inkMuted : colors.inkSecondary, textAlign: 'center' }]}>
              No sessions yet. Start your first focus session!
            </Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
          />
        )}
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
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  statCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  listSection: {
    flex: 1,
  },
  listContent: {
    gap: spacing.md,
  },
  sessionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  sessionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  sessionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sessionRight: {
    alignItems: 'flex-end',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
});
