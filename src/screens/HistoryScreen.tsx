import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, FlatList } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Session, Task } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'History'>;
};

type HistoryItem = Session & { taskName?: string };

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatRange(item: Session): string {
  const start = formatTime(item.startedAt);
  const end = item.endedAt ? formatTime(item.endedAt) : 'now';
  return `${formatDate(item.startedAt)} · ${start} – ${end}`;
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

  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;

  return (
    <Animated.View style={[styles.sessionCard, animStyle, { backgroundColor: isDark ? darkColors.paperCard : colors.paperCard, borderColor: isDark ? darkColors.ink : colors.ink }]}>
      <View style={styles.sessionLeft}>
        <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>{item.taskName}</Text>
        <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>{formatRange(item)}</Text>
      </View>
      <Text style={[typography.bodyMedium, { color: ink }]}>{formatMs(item.duration || 0)}</Text>
      <Text style={[typography.h2, { color: muted }]}>{'>'}</Text>
    </Animated.View>
  );
}

export default function HistoryScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const [sessions, setSessions] = useState<HistoryItem[]>([]);
  const [streak, setStreak] = useState(0);

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const statsOpacity = useSharedValue(0);
  const statsTranslateY = useSharedValue(20);
  const listOpacity = useSharedValue(0);
  const listTranslateY = useSharedValue(20);

  useFocusEffect(
    useCallback(() => {
      loadData().catch(() => {});
    }, []),
  );

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    statsOpacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    statsTranslateY.value = withDelay(250, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    listOpacity.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    listTranslateY.value = withDelay(400, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const loadData = async () => {
    try {
      const allSessions = await store.getSessions();
      const tasks = await store.getTasks();
      const taskMap = new Map(tasks.map((t: Task) => [t.id, t.name]));
      const withNames: HistoryItem[] = allSessions.map((s: Session) => ({
        ...s,
        taskName: taskMap.get(s.taskId) || 'Unknown',
      }));
      setSessions(withNames);
      setStreak(await store.getStreak());
    } catch {
      setSessions([]);
    }
  };

  // Mon–Sun minutes, computed inline from sessions.
  const weekMinutes = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    if (!s.duration) continue;
    weekMinutes[(new Date(s.startedAt).getDay() + 6) % 7] += s.duration / 60000;
  }
  const weekMax = Math.max(1, ...weekMinutes);

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

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const track = isDark ? darkColors.paperBorder : colors.paperBorder;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={[typography.bodyMedium, { color: colors.macawBlue }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={[typography.h1, { color: ink }]}>History</Text>
          <View style={{ width: 50 }} />
        </View>
      </Animated.View>

      <Animated.View style={[styles.streakSection, statsAnimStyle]}>
        <Image source={require('../../assets/flame.png')} style={styles.streakFlame} resizeMode="contain" />
        <Text style={[typography.displayXL, { color: ink }]}>{streak}</Text>
        <Text style={[typography.button, { color: colors.fire, marginTop: spacing.xs }]}>DAY STREAK!</Text>
        <Text style={[typography.caption, { color: muted, marginTop: spacing.xs }]}>
          {streak > 0 ? 'Keep going — every focus day counts.' : 'Finish a session to start your streak.'}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.chartSection, statsAnimStyle]}>
        <View style={styles.chartRow}>
          {weekMinutes.map((mins, i) => (
            <View key={WEEK_DAYS[i]} style={styles.chartCol}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: mins > 0 ? 8 + (mins / weekMax) * 88 : 4,
                      backgroundColor: mins > 0 ? colors.ectoGreen : track,
                    },
                  ]}
                />
              </View>
              <Text style={[typography.caption, { color: muted, marginTop: spacing.xs }]}>
                {WEEK_DAYS[i][0]}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>

      <Animated.View style={[styles.listSection, listAnimStyle]}>
        <Text style={[typography.label, { color: muted, marginBottom: spacing.sm }]}>
          PAST SESSIONS
        </Text>
        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Image source={mascotSource('peeking', isDark)} style={styles.emptyImage} resizeMode="contain" />
            <Text style={[typography.bodyMedium, { color: muted, textAlign: 'center' }]}>
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
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  streakSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  streakFlame: {
    width: 48,
    height: 36,
  },
  chartSection: {
    marginBottom: spacing.xl,
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartCol: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    height: 104,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 16,
    borderRadius: 4,
  },
  listSection: {
    flex: 1,
  },
  listContent: {
    gap: spacing.md,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    gap: spacing.md,
  },
  sessionLeft: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyImage: {
    width: 130,
    height: 130,
    marginBottom: spacing.lg,
  },
});
