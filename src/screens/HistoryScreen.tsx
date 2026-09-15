import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, FlatList, ScrollView, Share } from 'react-native';
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
import { Session, Task, BlockedAttempt } from '../types';
import AppBlocker from '../native/AppBlocker';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { ChevronRightIcon, ChevronLeftIcon, FlameIcon, TaskGlyph } from '../components/icons';
import type { ImageSourcePropType } from 'react-native';
import { tap } from '../haptics';

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

/** P0-1 hero format: "Xh Ym" reclaimed. */
function formatReclaimed(totalMs: number): string {
  const totalMin = Math.floor(totalMs / 60000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
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
  return `${formatDate(item.startedAt)} · ${start} - ${end}`;
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
    <Animated.View style={[styles.sessionCard, animStyle, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? darkColors.paperBorder : colors.paperBorder }]}>
      <View style={styles.sessionLeft}>
        <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>{item.taskName}</Text>
        <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>{formatRange(item)}</Text>
      </View>
      <Text style={[typography.bodyMedium, { color: ink }]}>{formatMs(item.duration || 0)}</Text>
      <ChevronRightIcon size={20} color={muted} />
    </Animated.View>
  );
}

// Installed-app labels/icons: the query renders an icon per app, so repeat
// visits reuse a short-lived module cache instead of blocking the paint.
let appMetaCache: { at: number; labels: Record<string, string>; icons: Record<string, string> } | null = null;
const APP_META_TTL_MS = 5 * 60 * 1000;

// Per-milestone badge art, cut from assets/milestones.png into
// assets/badges/. Earned = full color, locked = dimmed.
const MILESTONE_ART: Record<string, ImageSourcePropType> = {
  'focus-10': require('../../assets/badges/focus-10.png'),
  'focus-100': require('../../assets/badges/focus-100.png'),
  'focus-500': require('../../assets/badges/focus-500.png'),
  'streak-7': require('../../assets/badges/streak-7.png'),
  'streak-30': require('../../assets/badges/streak-30.png'),
  'streak-100': require('../../assets/badges/streak-100.png'),
  'resist-100': require('../../assets/badges/resist-100.png'),
  'resist-1000': require('../../assets/badges/resist-1000.png'),
};

export default function HistoryScreen({ navigation }: Props) {
  const { isDark } = useTheme();
  const [sessions, setSessions] = useState<HistoryItem[]>([]);
  const [streak, setStreak] = useState(0);
  const [attempts, setAttempts] = useState<BlockedAttempt[]>([]);
  const [appLabels, setAppLabels] = useState<Record<string, string>>({});
  const [appIcons, setAppIcons] = useState<Record<string, string>>({});
  const [reclaimed, setReclaimed] = useState({ focusMs: 0, resistCount: 0, estimatedMs: 0, totalMs: 0 });
  const [milestones, setMilestones] = useState<
    { id: string; label: string; progress: number; target: number; earned: boolean }[]
  >([]);

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
    // Store reads run in parallel and paint immediately. The slow
    // package-manager query (per-app icon renders) runs last via
    // loadAppMeta and upgrades labels/icons in place.
    try {
      const [allSessions, tasks, currentStreak, blockedAttempts, timeReclaimed, milestoneList] = await Promise.all([
        store.getSessions(),
        store.getTasks(),
        store.getStreak(),
        store.getBlockedAttempts(),
        store.getTimeReclaimed(7),
        store.getMilestones(),
      ]);
      const taskMap = new Map(tasks.map((t: Task) => [t.id, t.name]));
      const withNames: HistoryItem[] = allSessions.map((s: Session) => ({
        ...s,
        taskName: taskMap.get(s.taskId) || 'Unknown',
      }));
      setSessions(withNames);
      setStreak(currentStreak);
      setAttempts(blockedAttempts);
      setReclaimed(timeReclaimed);
      setMilestones(milestoneList);
    } catch {
      setSessions([]);
    }
    loadAppMeta().catch(() => {});
  };

  const loadAppMeta = async () => {
    // Repeat visits paint instantly from cache; the query refreshes in the
    // background on TTL expiry (new installs pick up within minutes).
    if (appMetaCache && Date.now() - appMetaCache.at < APP_META_TTL_MS) {
      setAppLabels(appMetaCache.labels);
      setAppIcons(appMetaCache.icons);
      return;
    }
    try {
      const apps = await AppBlocker.getInstalledApps();
      const map: Record<string, string> = {};
      const icons: Record<string, string> = {};
      for (const a of apps) {
        map[a.packageName] = a.appName;
        if (a.iconBase64) icons[a.packageName] = a.iconBase64;
      }
      appMetaCache = { at: Date.now(), labels: map, icons };
      setAppLabels(map);
      setAppIcons(icons);
    } catch {
      // Labels fall back to package names; icons to the glyph.
    }
  };

  // Mon–Sun minutes, computed inline from sessions.
  const weekMinutes = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    if (!s.duration) continue;
    weekMinutes[(new Date(s.startedAt).getDay() + 6) % 7] += s.duration / 60000;
  }
  const weekMax = Math.max(1, ...weekMinutes);

  // Advanced stats (all users, read-only, computed inline).
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const nowTs = Date.now();
  const recentSessions = sessions.filter(s => s.startedAt >= nowTs - SEVEN_DAYS_MS && (s.duration || 0) > 0);  const weeklyTotalMin = Math.floor(recentSessions.reduce((sum, s) => sum + (s.duration || 0), 0) / 60000);
  const recentDayMinutes = [0, 0, 0, 0, 0, 0, 0];
  for (const s of recentSessions) {
    recentDayMinutes[(new Date(s.startedAt).getDay() + 6) % 7] += (s.duration || 0) / 60000;
  }
  const bestDayIdx = recentDayMinutes.indexOf(Math.max(...recentDayMinutes));
  const attemptCounts = new Map<string, number>();
  for (const a of attempts) attemptCounts.set(a.packageName, (attemptCounts.get(a.packageName) ?? 0) + 1);
  const ranking = [...attemptCounts.entries()]
    .map(([packageName, count]) => ({ packageName, label: appLabels[packageName] ?? packageName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const rankMax = Math.max(1, ...ranking.map(r => r.count));

  // P1-3: intention breaks render distinctly from plain attempts.
  const breaks = attempts
    .filter(a => a.action === 'break')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  // P0-1 text share (built-in Share only, no new deps).
  const handleShareReclaimed = async () => {
    tap();
    try {
      await Share.share({
        message: `I reclaimed ${formatReclaimed(reclaimed.totalMs)} this week with StayT, ${reclaimed.resistCount} distractions resisted. Small steps build big progress.`,
      });
    } catch {
      // Share sheet is best-effort.
    }
  };

  // P1-4 earned milestone -> built-in text share.
  const handleShareMilestone = async (label: string, progress: number) => {
    tap();
    try {
      await Share.share({
        message: `I earned "${label}" on StayT. Small steps build big progress.`,
      });
    } catch {
      // Share sheet is best-effort.
    }
  };

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
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const border = isDark ? darkColors.ink : colors.ink;
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
                <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backIcon} accessibilityRole="button" accessibilityLabel="Back">
                  <ChevronLeftIcon size={24} color={ink} />
                </TouchableOpacity>
                <View style={{ width: 50 }} />
              </View>
            </Animated.View>

            <Animated.View style={[styles.streakSection, statsAnimStyle]}>
              <View style={styles.streakRow}>
                <FlameIcon size={80} color={streakGreen} />
                <Text style={[typography.displayXL, { color: streakGreen }]}>{streak}</Text>
              </View>
              <Text style={[typography.display, { color: streakGreen, textAlign: 'center', marginTop: spacing.xs }]}>DAY STREAK!</Text>
            </Animated.View>

            {/* Single week card: chart + total + best day + reclaimed. */}
            <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[typography.cta, { color: ink }]}>THIS WEEK</Text>
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
              <View style={styles.weekTotalRow}>
                <Text style={[typography.displayXL, { color: ink }]}>{weeklyTotalMin}</Text>
                <Text style={[typography.label, { color: muted, marginTop: spacing.xs }]}>
                  MINUTES
                </Text>
              </View>
              <View style={styles.bestDayRow}>
                <Text style={[typography.label, { color: muted }]}>BEST DAY</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  {weeklyTotalMin > 0 ? WEEK_DAYS[bestDayIdx].toUpperCase() : '-'}
                </Text>
              </View>
              <View style={styles.bestDayRow}>
                <Text style={[typography.label, { color: muted }]}>RECLAIMED</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>
                  {formatReclaimed(reclaimed.totalMs).toUpperCase()}
                </Text>
              </View>
              <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
                {`${formatMs(reclaimed.focusMs)} focus, ${reclaimed.resistCount} resists`}
              </Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={handleShareReclaimed}
                style={styles.shareLink}
              >
                <Text style={[typography.button, { color: streakGreen, textAlign: 'center' }]}>
                  SHARE
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* P1-4 milestone row: earned taps share, locked show progress. */}
            {milestones.length > 0 && (
              <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={[typography.cta, { color: ink }]}>MILESTONES</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mileRow}>
                  {milestones.map(m => {
                    return (
                      <TouchableOpacity
                        key={m.id}
                        activeOpacity={m.earned ? 0.7 : 1}
                        disabled={!m.earned}
                        onPress={() => handleShareMilestone(m.label, m.progress)}
                      style={[
                        styles.mileChip,
                        { borderColor: border },
                        m.earned && styles.mileChipEarned,
                      ]}
                      accessibilityRole={m.earned ? 'button' : 'text'}
                      accessibilityLabel={m.earned ? `${m.label} earned. Share.` : `${m.label}, ${Math.floor(m.progress)} of ${m.target}`}
                    >
                        <Image
                          source={MILESTONE_ART[m.id]}
                          style={[styles.badgeImage, { opacity: m.earned ? 1 : 0.35 }]}
                          resizeMode="cover"
                        />
                        <Text style={[typography.bodyMedium, { color: m.earned ? colors.midnight : ink, textAlign: 'center' }]} numberOfLines={2}>
                          {m.label.toUpperCase()}
                        </Text>
                        <Text style={[typography.caption, { color: m.earned ? colors.midnight : muted, textAlign: 'center', marginTop: 2 }]}>
                          {m.earned ? 'TAP TO SHARE' : `${Math.floor(m.progress)}/${m.target}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            )}

            <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[typography.cta, { color: ink }]}>MOST BLOCKED</Text>
              {ranking.length === 0 ? (
                <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                  No blocks yet. Stay focused!
                </Text>
              ) : (
                ranking.map((r, i) => (
                  <View key={r.packageName} style={styles.rankRow}>
                    <Text style={[typography.bodyMedium, { color: ink, width: 20 }]}>{i + 1}</Text>
                    {appIcons[r.packageName] ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${appIcons[r.packageName]}` }}
                        style={styles.appIcon}
                      />
                    ) : (
                      <View style={styles.appIconFallback}>
                        <TaskGlyph name={r.label} size={18} color={colors.midnight} />
                      </View>
                    )}
                    <View style={styles.rankMain}>
                      <View style={styles.rankTopRow}>
                        <Text style={[typography.bodyMedium, { color: ink, flex: 1 }]} numberOfLines={1}>
                          {r.label}
                        </Text>
                        <Text style={[typography.caption, { color: muted }]}>{r.count}×</Text>
                      </View>
                      <View style={[styles.rankTrack, { backgroundColor: track }]}>
                        <View style={[styles.rankFill, { width: `${(r.count / rankMax) * 100}%` }]} />
                      </View>
                    </View>
                  </View>
                ))
              )}
            </Animated.View>

            {sessions.length > 0 && (
              <Animated.View style={[styles.listLabelWrap, listAnimStyle]}>
                <Text style={[typography.cta, { color: ink }]}>
                  PAST SESSIONS
                </Text>
              </Animated.View>
            )}

            {/* P1-3 intention breaks: distinct section, latest first. */}
            {breaks.length > 0 && (
              <Animated.View style={[styles.statCard, listAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={[typography.h3, { color: ink }]}>INTENTION BREAKS</Text>
                {breaks.map(b => (
                  <View key={b.id} style={styles.breakRow}>
                    {appIcons[b.packageName] ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${appIcons[b.packageName]}` }}
                        style={styles.appIcon}
                      />
                    ) : (
                      <View style={styles.appIconFallback}>
                        <TaskGlyph name={appLabels[b.packageName] ?? b.packageName} size={18} color={colors.midnight} />
                      </View>
                    )}
                    <View style={styles.breakMain}>
                      <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={2}>
                        {b.intention ? `“${b.intention}”` : 'Intention break'}
                      </Text>
                      <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                        {`${appLabels[b.packageName] ?? b.packageName} · ${b.breakMinutes ?? 5} min · ${formatDate(b.timestamp)}`}
                      </Text>
                    </View>
                  </View>
                ))}
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
              onPress={() => { tap(); navigation.navigate('TaskPicker'); }}
            >
              <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
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
  backIcon: {
    width: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  streakTextCol: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  chartRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
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
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  statCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  bestDayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  rankMain: {
    flex: 1,
  },
  appIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  appIconFallback: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rankTrack: {
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    overflow: 'hidden',
  },
  rankFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.ectoGreen,
  },
  weekTotalRow: {
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  shareLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.sm,
  },
  mileRow: {
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  mileChip: {
    width: 148,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 168,
  },
  badgeImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginBottom: spacing.sm,
  },
  mileChipEarned: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreenDark,
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  breakMain: {
    flex: 1,
  },
  listLabelWrap: {
    marginBottom: spacing.sm,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
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
