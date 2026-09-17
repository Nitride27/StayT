import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Session, BlockedAttempt } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { ChevronLeftIcon } from '../components/icons';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SessionDetail'>;
  route: { params: { sessionId: string } };
};

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

function actionLabel(a: BlockedAttempt): string {
  if (a.action === 'override') return 'Override';
  if (a.action === 'break') return 'Break';
  if (a.action === 'friction_pass') return 'Resist';
  return 'Block';
}

export default function SessionDetailScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [taskName, setTaskName] = useState('Unknown');
  const [timeline, setTimeline] = useState<BlockedAttempt[]>([]);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [allSessions, tasks, attempts] = await Promise.all([
        store.getSessions(),
        store.getTasks(),
        store.getBlockedAttempts(),
      ]);
      const found = allSessions.find(s => s.id === route.params.sessionId) ?? null;
      if (!found) {
        setMissing(true);
        return;
      }
      setSession(found);
      setTaskName(tasks.find(t => t.id === found.taskId)?.name ?? 'Unknown');
      const end = found.endedAt ?? Date.now();
      const inWindow = attempts
        .filter(a => a.timestamp >= found.startedAt && a.timestamp <= end)
        .filter(a => !a.taskId || a.taskId === found.taskId)
        .sort((a, b) => a.timestamp - b.timestamp);
      setTimeline(inWindow);
    } catch {
      setMissing(true);
    }
  }, [route.params.sessionId]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load]),
  );

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const border = isDark ? darkColors.ink : colors.ink;

  const blocks = timeline.length;
  const resists = timeline.filter(a => a.action !== 'override').length;
  const overrides = timeline.filter(a => a.action === 'override').length;
  const breaks = timeline.filter(a => a.action === 'break').length;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backIcon} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeftIcon size={24} color={ink} />
            </TouchableOpacity>
            <Text style={[typography.display, { color: ink }]}>SESSION</Text>
            <View style={{ width: 50 }} />
          </View>
        </View>

        {missing || !session ? (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[typography.bodyMedium, { color: muted, textAlign: 'center' }]}>
              Session not found.
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>{taskName}</Text>
              <Text style={[typography.caption, { color: muted, marginTop: spacing.xs }]}>
                {`${formatDate(session.startedAt)} · ${formatTime(session.startedAt)} - ${session.endedAt ? formatTime(session.endedAt) : 'now'}`}
              </Text>
              <View style={styles.statRow}>
                <Text style={[typography.label, { color: muted }]}>DURATION</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>{formatMs(session.duration || 0)}</Text>
              </View>
            </View>

            <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
              <View style={styles.statRow}>
                <Text style={[typography.label, { color: muted }]}>BLOCKS</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>{blocks}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={[typography.label, { color: muted }]}>RESISTS</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>{resists}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={[typography.label, { color: muted }]}>OVERRIDES</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>{overrides}</Text>
              </View>
              <View style={styles.statRow}>
                <Text style={[typography.label, { color: muted }]}>BREAKS</Text>
                <Text style={[typography.bodyMedium, { color: ink }]}>{breaks}</Text>
              </View>
            </View>

            <Text style={[typography.cta, { color: ink, marginBottom: spacing.sm }]}>TIMELINE</Text>
            <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
              {timeline.length === 0 ? (
                <Text style={[typography.caption, { color: muted }]}>No blocks in this session.</Text>
              ) : (
                timeline.map(a => (
                  <View key={a.id} style={styles.timelineRow}>
                    <View style={styles.timelineMain}>
                      <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={2}>
                        {a.intention ? `"${a.intention}"` : actionLabel(a)}
                      </Text>
                      <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                        {`${actionLabel(a)} · ${formatTime(a.timestamp)}`}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
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
  scrollContent: {
    paddingBottom: spacing.xxl,
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
  card: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  timelineMain: {
    flex: 1,
  },
});
