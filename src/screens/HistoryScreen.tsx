import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Session } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, gamification, layout } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

type SessionWithTask = Session & { taskName: string };

export default function HistoryScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [sessions, setSessions] = useState<SessionWithTask[]>([]);
  const [totalTime, setTotalTime] = useState(0);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const allSessions = await store.getSessions();
    const tasks = await store.getTasks();

    const completed = allSessions
      .filter(s => s.status === 'completed')
      .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
      .map(s => ({
        ...s,
        taskName: tasks.find(t => t.id === s.taskId)?.name || 'Unknown',
      }));

    setSessions(completed);

    const total = completed.reduce((acc, s) => acc + (s.duration || 0), 0);
    setTotalTime(total);

    const currentStreak = await store.getStreak();
    setStreak(currentStreak);
  };

  const formatDuration = (ms: number) => {
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / 86400000);

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const renderSession = ({ item }: { item: SessionWithTask }) => (
    <View style={[styles.sessionCard, { backgroundColor: colors.paperCard, borderRadius: radius.md }]}>
      <View style={styles.sessionRow}>
        <View style={styles.sessionLeft}>
          <Text style={[typography.bodyMedium, { color: colors.ink }]}>{item.taskName}</Text>
          <Text style={[typography.caption, { color: colors.inkMuted, marginTop: spacing.xs }]}>
            {formatDate(item.endedAt || item.startedAt)}
          </Text>
        </View>
        <View style={styles.sessionRight}>
          <Text style={[typography.bodyBold, { color: colors.ectoGreen }]}>
            {formatDuration(item.duration || 0)}
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.paper }]}>
      <View style={[styles.header, { paddingTop: layout.headerPaddingTop, paddingHorizontal: layout.screenPaddingH, paddingBottom: layout.headerPaddingBottom }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={[typography.bodyMedium, { color: colors.macawBlue }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={[typography.h1, { color: colors.ink }]}>History</Text>
          <View style={{ width: 50 }} />
        </View>
      </View>

      {/* Stats Row */}
      <View style={[styles.statsRow, { paddingHorizontal: layout.screenPaddingH, marginBottom: spacing.xl }]}>
        <View style={[styles.statCard, { backgroundColor: colors.paperCard, borderRadius: radius.md }]}>
          <Text style={[typography.caption, { color: colors.inkMuted }]}>Total Time</Text>
          <Text style={[typography.h2, { color: colors.ectoGreen, marginTop: spacing.xs }]}>{formatDuration(totalTime)}</Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: colors.paperCard, borderRadius: radius.md }]}>
          <Text style={[typography.caption, { color: colors.inkMuted }]}>Sessions</Text>
          <Text style={[typography.h2, { color: colors.macawBlue, marginTop: spacing.xs }]}>{sessions.length}</Text>
        </View>

        <View style={[styles.statCard, { backgroundColor: colors.paperCard, borderRadius: radius.md }]}>
          <Text style={[typography.caption, { color: colors.inkMuted }]}>Streak</Text>
          <View style={styles.streakStat}>
            <Text style={{ fontSize: 18 }}>🔥</Text>
            <Text style={[typography.h2, { color: colors.fire, marginTop: spacing.xs }]}>{streak}</Text>
          </View>
        </View>
      </View>

      {/* Session List */}
      {sessions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={{ fontSize: 48 }}>📋</Text>
          <Text style={[typography.bodyMedium, { color: colors.inkMuted, marginTop: spacing.lg }]}>
            No sessions yet. Start your first task!
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          renderItem={renderSession}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.listContent, { paddingHorizontal: layout.screenPaddingH }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCard: {
    flex: 1,
    padding: spacing.md,
    alignItems: 'center',
  },
  streakStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  listContent: {
    paddingBottom: spacing.xxxl,
  },
  sessionCard: {
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionLeft: {
    flex: 1,
  },
  sessionRight: {
    marginLeft: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: spacing.xxxl,
  },
});
