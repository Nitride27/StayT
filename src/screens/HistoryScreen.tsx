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
import { ChevronRightIcon, ChevronLeftIcon, FlameIcon } from '../components/icons';

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
    opacity.value = withDelay(delay, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
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
      <ChevronRightIcon size={20} color={muted} />
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
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    statsOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    statsTranslateY.value = withDelay(250, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    listOpacity.value = withDelay(400, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    listTranslateY.value = withDelay(400, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
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
  // Contrast-safe streak green: ectoGreen on dark, darker green on light.
  const streakGreen = isDark ? colors.ectoGreen : colors.ectoGreenDark;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <Animated.View style={[styles.header, headerAnimStyle]}>
              <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.navLink} accessibilityRole="button" accessibilityLabel="Back">
                  <View style={styles.backRow}>
                    <ChevronLeftIcon size={18} color={ink} />
                    <Text style={[typography.bodyMedium, { color: ink }]}>Back</Text>
                  </View>
                </TouchableOpacity>
                <Text style={[typography.h1, { color: ink }]}>History</Text>
                <View style={{ width: 50 }} />
              </View>
            </Animated.View>

            <Animated.View style={[styles.streakSection, statsAnimStyle]}>
              <View style={styles.streakRow}>
                <FlameIcon size={48} color={streakGreen} />
                <Text style={[typography.displayXL, { color: streakGreen }]}>{streak}</Text>
                <Text style={[typography.button, { color: streakGreen }]}>DAY STREAK!</Text>
              </View>
              <Text style={[typography.caption, { color: muted, marginTop: spacing.xs, textAlign: 'center' }]}>
                Keep going. You're building great habits.
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
                      {WEEK_DAYS[i]}
                    </Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            {sessions.length > 0 && (
              <Animated.View style={[styles.listLabelWrap, listAnimStyle]}>
                <Text style={[typography.label, { color: muted }]}>
                  PAST SESSIONS
                </Text>
              </Animated.View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Image source={mascotSource('peeking', isDark)} style={styles.emptyImage} resizeMode="contain" />
            <Text style={[typography.bodyMedium, { color: muted, textAlign: 'center' }]}>
              No sessions yet. Start your first focus session!
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('TaskPicker')}
            >
              <Text style={[typography.button, { color: colors.midnight, textAlign: 'center' }]}>
                START A SESSION
              </Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: layout.headerPaddingTop,
    paddingBottom: layout.safeAreaBottom,
    flexGrow: 1,
    gap: 0,
  },
  header: {
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navLink: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderRadius: radius.md,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  streakSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
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
    height: 96,
    justifyContent: 'flex-end',
  },
  bar: {
    width: 10,
    borderRadius: 4,
  },
  listLabelWrap: {
    marginBottom: spacing.sm,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    gap: spacing.md,
    marginBottom: spacing.md,
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
    width: 160,
    height: 160,
    marginBottom: spacing.lg,
  },
  emptyButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 18,
    paddingHorizontal: spacing.xl,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
});
