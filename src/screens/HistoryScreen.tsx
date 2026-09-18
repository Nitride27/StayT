import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { mascotSource, owlMoodLabel } from '../theme/mascot';
import WitheringOwl from '../components/WitheringOwl';
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

function SessionRowContent({ item, isDark }: { item: HistoryItem; isDark: boolean }) {
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;

  return (
    <>
      <View style={styles.sessionLeft}>
        <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>{item.taskName}</Text>
        <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>{formatRange(item)}</Text>
      </View>
      <Text style={[typography.bodyMedium, { color: ink }]}>{formatMs(item.duration || 0)}</Text>
      <ChevronRightIcon size={20} color={muted} />
    </>
  );
}

function AnimatedSessionCard({ item, index, isDark }: { item: HistoryItem; index: number; isDark: boolean }) {
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

  return (
    <Animated.View style={[styles.sessionCard, animStyle, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? darkColors.paperBorder : colors.paperBorder }]}>
      <SessionRowContent item={item} isDark={isDark} />
    </Animated.View>
  );
}

// Only the first rows animate in: a per-row stagger over hundreds of past
// sessions piles up seconds of scheduled animations and mounts a Reanimated
// node per row. The rest render statically (same layout, no animation).
const SessionCard = React.memo(function SessionCard({ item, index, isDark }: { item: HistoryItem; index: number; isDark: boolean }) {
  if (index >= 8) {
    return (
      <View style={[styles.sessionCard, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: isDark ? darkColors.paperBorder : colors.paperBorder }]}>
        <SessionRowContent item={item} isDark={isDark} />
      </View>
    );
  }
  return <AnimatedSessionCard item={item} index={index} isDark={isDark} />;
});

// Quiet load-more control shared by MOST BLOCKED + PAST SESSIONS: a progress
// hint ("Showing 5 of 12") over a full-width outline button ("Show 7 more" /
// "Show less"). The button is the single 48px target; the hint is text only.
function LoadMoreControl(props: {
  shown: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  track: string;
  ink: string;
  muted: string;
  kind: 'sessions' | 'apps';
}) {
  const remaining = props.total - props.shown;
  const unit = props.kind === 'sessions' ? 'sessions' : 'apps';
  return (
    <View style={[styles.loadMoreWrap, { borderTopColor: props.track }]}>
      <Text style={[typography.caption, { color: props.muted, textAlign: 'center' }]}>
        {props.expanded ? `Showing ${props.total} of ${props.total}` : `Showing ${props.shown} of ${props.total}`}
      </Text>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={props.onToggle}
        style={[styles.loadMoreBtn, { borderColor: props.track }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        accessibilityLabel={
          props.expanded
            ? `${props.kind === 'sessions' ? 'Session' : 'Blocked'} list expanded, ${props.total} ${unit}`
            : remaining === 1
              ? `Show more ${unit}, showing ${props.shown} of ${props.total}`
              : `Show ${remaining} more ${unit}, showing ${props.shown} of ${props.total}`
        }
      >
        <Text style={[typography.button, { color: props.ink, fontSize: 14, lineHeight: 18, textAlign: 'center' }]}>
          {props.expanded ? 'Show less' : remaining === 1 ? 'Show more' : `Show ${remaining} more`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// Installed-app labels/icons: the query renders an icon per app, so repeat
// visits reuse a short-lived module cache instead of blocking the paint.
let appMetaCache: { at: number; labels: Record<string, string>; icons: Record<string, string> } | null = null;
const APP_META_TTL_MS = 5 * 60 * 1000;

// Per-milestone badge art in assets/badges/. Two variants per badge:
// dark-theme originals + light-theme set (achromatic black↔white swapped,
// saturated accent hues kept) in assets/badges/light/. Earned = full color,
// locked = dimmed.
const MILESTONE_ART_DARK: Record<string, ImageSourcePropType> = {
  'focus-10': require('../../assets/badges/focus-10.png'),
  'focus-100': require('../../assets/badges/focus-100.png'),
  'focus-500': require('../../assets/badges/focus-500.png'),
  'streak-7': require('../../assets/badges/streak-7.png'),
  'streak-30': require('../../assets/badges/streak-30.png'),
  'streak-100': require('../../assets/badges/streak-100.png'),
  'resist-100': require('../../assets/badges/resist-100.png'),
  'resist-1000': require('../../assets/badges/resist-1000.png'),
};
const MILESTONE_ART_LIGHT: Record<string, ImageSourcePropType> = {
  'focus-10': require('../../assets/badges/light/focus-10.png'),
  'focus-100': require('../../assets/badges/light/focus-100.png'),
  'focus-500': require('../../assets/badges/light/focus-500.png'),
  'streak-7': require('../../assets/badges/light/streak-7.png'),
  'streak-30': require('../../assets/badges/light/streak-30.png'),
  'streak-100': require('../../assets/badges/light/streak-100.png'),
  'resist-100': require('../../assets/badges/light/resist-100.png'),
  'resist-1000': require('../../assets/badges/light/resist-1000.png'),
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
  // Wave 2C2 analytics depth (additive): range switcher + Pro gate.
  // Default TODAY (free); WEEK/MONTH render numbers only when subscribed.
  const [range, setRange] = useState<'today' | 'week' | 'month'>('today');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [giveInsToday, setGiveInsToday] = useState(0);
  const [showAllRanking, setShowAllRanking] = useState(false);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [sessionSort, setSessionSort] = useState<'newest' | 'longest' | 'blocks'>('newest');

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
    // Wave 2C2: subscription re-checked on every focus (Pro expiry mid-view
    // locks WEEK/MONTH on the next visit) + owl mood give-ins. Best-effort.
    try {
      const prefs = await store.getPreferences();
      setIsSubscribed(prefs.isSubscribed === true);
    } catch {
      setIsSubscribed(false);
    }
    try {
      setGiveInsToday(await store.getGiveInsToday());
    } catch {
      setGiveInsToday(0);
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

  // Wave 2C2 range filter (additive): the existing week math below is
  // unchanged — it now reads rangedSessions instead of sessions. The week
  // window (7d) is identical to the old inline filter.
  const { rangeStartMs, todayStartMs } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const start =
      range === 'today' ? today : Date.now() - (range === 'month' ? 30 : 7) * 24 * 60 * 60 * 1000;
    return { rangeStartMs: start, todayStartMs: today };
  }, [range]);
  const rangedSessions = useMemo(
    () => sessions.filter(s => s.startedAt >= rangeStartMs),
    [sessions, rangeStartMs],
  );
  // Wave 2C2: WEEK/MONTH numbers are Pro-gated; TODAY is always free.
  const numbersLocked = !isSubscribed && range !== 'today';
  const rangeCardTitle = range === 'today' ? 'TODAY' : range === 'month' ? 'THIS MONTH' : 'THIS WEEK';

  // Mon–Sun minutes, computed inline from sessions.
  const { weekMinutes, weekMax } = useMemo(() => {
    const mins = [0, 0, 0, 0, 0, 0, 0];
    for (const s of rangedSessions) {
      if (!s.duration) continue;
      mins[(new Date(s.startedAt).getDay() + 6) % 7] += s.duration / 60000;
    }
    return { weekMinutes: mins, weekMax: Math.max(1, ...mins) };
  }, [rangedSessions]);

  // Advanced stats (all users, read-only). Memoized: these scan every
  // session/attempt, which gets expensive with months of history.
  const { weeklyTotalMin, recentDayMinutes, bestDayIdx } = useMemo(() => {
    const recent = rangedSessions.filter(s => (s.duration || 0) > 0);
    const total = Math.floor(recent.reduce((sum, s) => sum + (s.duration || 0), 0) / 60000);
    const days = [0, 0, 0, 0, 0, 0, 0];
    for (const s of recent) {
      days[(new Date(s.startedAt).getDay() + 6) % 7] += (s.duration || 0) / 60000;
    }
    return { weeklyTotalMin: total, recentDayMinutes: days, bestDayIdx: days.indexOf(Math.max(...days)) };
  }, [rangedSessions]);
  // Wave 2C2: free sees today's top only; Pro sees the range ranking.
  const { ranking, rankMax } = useMemo(() => {
    const start = isSubscribed ? rangeStartMs : todayStartMs;
    const attemptCounts = new Map<string, number>();
    for (const a of attempts) {
      if (a.timestamp < start) continue;
      attemptCounts.set(a.packageName, (attemptCounts.get(a.packageName) ?? 0) + 1);
    }
    const top = [...attemptCounts.entries()]
      .map(([packageName, count]) => ({ packageName, label: appLabels[packageName] ?? packageName, count }))
      .sort((a, b) => b.count - a.count);
    return { ranking: top, rankMax: Math.max(1, ...top.map(r => r.count)) };
  }, [attempts, appLabels, isSubscribed, rangeStartMs, todayStartMs]);
  const displayedRanking = showAllRanking ? ranking : ranking.slice(0, 5);

  const sessionBlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const end = s.endedAt ?? Date.now();
      let n = 0;
      for (const a of attempts) {
        if (a.timestamp >= s.startedAt && a.timestamp <= end) n++;
      }
      counts.set(s.id, n);
    }
    return counts;
  }, [sessions, attempts]);

  const sortedSessions = useMemo(() => {
    const list = [...sessions];
    if (sessionSort === 'longest') {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else if (sessionSort === 'blocks') {
      list.sort((a, b) => (sessionBlockCounts.get(b.id) ?? 0) - (sessionBlockCounts.get(a.id) ?? 0) || b.startedAt - a.startedAt);
    } else {
      list.sort((a, b) => b.startedAt - a.startedAt);
    }
    return list;
  }, [sessions, sessionSort, sessionBlockCounts]);
  const displayedSessions = showAllSessions ? sortedSessions : sortedSessions.slice(0, 5);

  // P1-3: intention breaks render distinctly from plain attempts.
  const breaks = useMemo(
    () => attempts.filter(a => a.action === 'break').sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [attempts],
  );

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

  const renderItem = useCallback(({ item, index }: { item: HistoryItem; index: number }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => { tap(); navigation.navigate('SessionDetail', { sessionId: item.id }); }}
      accessibilityRole="button"
      accessibilityLabel={`Open session ${item.taskName}`}
    >
      <SessionCard item={item} index={index} isDark={isDark} />
    </TouchableOpacity>
  ), [isDark, navigation]);

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
        data={displayedSessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        removeClippedSubviews
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          sortedSessions.length > 5 ? (
            <LoadMoreControl
              shown={5}
              total={sortedSessions.length}
              expanded={showAllSessions}
              onToggle={() => { tap(); setShowAllSessions(v => !v); }}
              track={track}
              ink={ink}
              muted={muted}
              kind="sessions"
            />
          ) : null
        }
        ListHeaderComponent={
          <>
            <Animated.View style={[styles.header, headerAnimStyle]}>
              <View style={styles.headerRow}>
                <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backIcon} accessibilityRole="button" accessibilityLabel="Back">
                  <ChevronLeftIcon size={24} color={ink} />
                </TouchableOpacity>
                <Text style={[typography.display, { color: ink }]}>
                  HISTORY
                </Text>
                <View style={{ width: 50 }} />
              </View>
            </Animated.View>

            <Animated.View style={[styles.streakSection, statsAnimStyle]}>
              {/* Wave 2C2: flame row dims when give-ins > 2 (no new art). */}
              <View style={[styles.streakRow, giveInsToday > 2 && { opacity: 0.6 }]}>
                <FlameIcon size={80} color={streakGreen} />
                <Text style={[typography.displayXL, { color: streakGreen }]}>{streak}</Text>
              </View>
              <Text style={[typography.display, { color: streakGreen, textAlign: 'center', marginTop: spacing.xs }]}>DAY STREAK!</Text>
              {/* Withering owl: dark themes composite transparency straight
                  onto the screen; light theme gets a deliberate midnight tile
                  (black art needs a dark stage — floating it on white reads
                  as a blob). */}
              <View style={{ alignItems: 'center', marginTop: spacing.md }}>
                <View
                  style={
                    isDark
                      ? undefined
                      : {
                          backgroundColor: colors.midnight,
                          borderRadius: radius.xl,
                          padding: spacing.md,
                          borderWidth: 2,
                          borderColor: colors.ectoGreenDark,
                        }
                  }
                >
                  <WitheringOwl giveInsToday={giveInsToday} width={200} />
                </View>
              </View>
              {/* Wave 2C2 owl mood line (additive, same helper as TaskPicker). */}
              <Text style={[typography.bodyMedium, { color: muted, textAlign: 'center', marginTop: spacing.sm }]}>
                {owlMoodLabel(giveInsToday)}
              </Text>
            </Animated.View>

            {/* Wave 2C2 range switcher (additive, above the numbers card).
                TODAY is free; WEEK/MONTH are Pro-gated below. */}
            <View style={styles.rangeRow} accessibilityRole="tablist" accessibilityLabel="History range">
              {(['today', 'week', 'month'] as const).map(r => {
                const active = range === r;
                return (
                  <TouchableOpacity
                    key={r}
                    activeOpacity={0.8}
                    onPress={() => { tap(); setRange(r); }}
                    style={[
                      styles.rangeBtn,
                      { borderColor: border },
                      active && styles.rangeBtnActive,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${r} history`}
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[typography.button, { color: active ? colors.midnight : muted, fontSize: 14, lineHeight: 18, textAlign: 'center' }]}>
                      {r.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Single week card: chart + total + best day + reclaimed. */}
            {numbersLocked ? (
              <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
                <Text style={[typography.cta, { color: ink }]}>PRO · UNLOCK HISTORY</Text>
                <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                  Week & month are Pro.
                </Text>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => { tap(); navigation.navigate('Paywall'); }}
                  style={styles.proButton}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock Pro history"
                >
                  <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
                    VIEW PRO
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            ) : (
            <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[typography.cta, { color: ink }]}>{rangeCardTitle}</Text>
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
            )}

            {/* P1-4 milestone row: always expanded; earned taps share. */}
            {milestones.length > 0 && (
              <>
                <Text style={[typography.cta, { color: ink, marginBottom: spacing.sm }]}>
                  MILESTONES
                </Text>
                <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
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
                          source={(isDark ? MILESTONE_ART_DARK : MILESTONE_ART_LIGHT)[m.id]}
                          style={[styles.badgeImage, { opacity: m.earned ? 1 : 0.35 }]}
                          resizeMode="cover"
                        />
                        <Text style={[typography.bodyMedium, { color: ink, textAlign: 'center' }]} numberOfLines={2}>
                          {m.label.toUpperCase()}
                        </Text>
                        <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: 2 }]}>
                          {m.earned ? 'TAP TO SHARE' : `${Math.floor(m.progress)}/${m.target}`}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                </Animated.View>
              </>
            )}

            <Text style={[typography.cta, { color: ink, marginBottom: spacing.sm }]}>
              {isSubscribed ? 'MOST BLOCKED' : "TODAY'S TOP"}
            </Text>
            <Animated.View style={[styles.statCard, statsAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
              {/* Wave 2C2: free sees today's top only (ranking memo is gated). */}
              {ranking.length === 0 ? (
                <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
                  No blocks yet. Stay focused!
                </Text>
              ) : (
                <>
                  {displayedRanking.map((r, i) => (
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
                  ))}
                  {ranking.length > 5 && (
                    <LoadMoreControl
                      shown={5}
                      total={ranking.length}
                      expanded={showAllRanking}
                      onToggle={() => { tap(); setShowAllRanking(v => !v); }}
                      track={track}
                      ink={ink}
                      muted={muted}
                      kind="apps"
                    />
                  )}
                </>
              )}
            </Animated.View>

            {sessions.length > 0 && (
              <Animated.View style={[styles.listLabelWrap, listAnimStyle]}>
                <Text style={[typography.cta, { color: ink }]}>
                  PAST SESSIONS
                </Text>
                <View style={styles.sortRow} accessibilityRole="tablist" accessibilityLabel="Sort past sessions">
                  {([
                    { key: 'newest', label: 'NEWEST' },
                    { key: 'longest', label: 'LONGEST' },
                    { key: 'blocks', label: 'MOST BLOCKS' },
                  ] as const).map(opt => {
                    const active = sessionSort === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        activeOpacity={0.8}
                        onPress={() => { tap(); setSessionSort(opt.key); }}
                        style={[
                          styles.rangeBtn,
                          { borderColor: border },
                          active && styles.rangeBtnActive,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Sort sessions by ${opt.label.toLowerCase()}`}
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[typography.button, { color: active ? colors.midnight : muted, fontSize: 12, lineHeight: 16, textAlign: 'center' }]}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Animated.View>
            )}

            {/* P1-3 intention breaks: always expanded, latest first. */}
            {breaks.length > 0 && (
              <>
                <Text style={[typography.cta, { color: ink, marginBottom: spacing.sm }]}>
                  INTENTION BREAKS
                </Text>
              <Animated.View style={[styles.statCard, listAnimStyle, { backgroundColor: cardBg, borderColor: border }]}>
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
              </>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Image source={mascotSource('peeking', isDark)} style={styles.emptyImage} resizeMode="contain" />
            <Text style={[typography.bodyMedium, { color: muted, textAlign: 'center' }]}>
              No sessions yet.
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
  // Wave 2C2 range switcher + Pro locked card (additive, existing tokens).
  rangeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rangeBtn: {
    flex: 1,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  rangeBtnActive: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 5,
    borderBottomColor: colors.ectoGreenDark,
  },
  proButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.md,
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
    // Per-theme art (dark set / light set) carries its own contrast, so the
    // medallion is plain transparent — no midnight fill, no ring workarounds.
    backgroundColor: 'transparent',
  },
  mileChipEarned: {
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
  sortRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Quiet load-more: centered progress hint over a full-width outline
  // button. The button is the single 48px target; the hint is text only.
  loadMoreWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
  },
  loadMoreBtn: {
    borderWidth: 2,
    borderRadius: radius.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
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
