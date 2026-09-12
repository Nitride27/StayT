import React, { useState, useEffect } from 'react';
import { View, Text, Image, Alert, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task, FocusSchedule, blockedPackagesOf } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { TaskGlyph, CheckIcon, ChevronLeftIcon } from '../components/icons';
import AppBlocker from '../native/AppBlocker';

type InstalledApp = { packageName: string; appName: string; iconBase64?: string };

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskSetup'>;
  route: { params: { task?: Task } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// Mon-first chip order; days use JS getDay() convention (0 = Sunday).
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MINUTE_STEPS = [0, 15, 30, 45];

function formatScheduleTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Re-push the store's schedules to native after every schedule edit.
// Source of truth stays in the store; native persists nothing.
async function syncSchedulesToNative(): Promise<void> {
  try {
    const [schedules, tasks] = await Promise.all([store.getSchedules(), store.getTasks()]);
    const byId = new Map(tasks.map(t => [t.id, t] as const));
    const payload = schedules
      .filter(s => byId.has(s.taskId))
      .map(s => ({
        days: s.days,
        startMinutes: s.startMinutes,
        endMinutes: s.endMinutes,
        enabled: s.enabled,
        blockedPackages: blockedPackagesOf(byId.get(s.taskId)!),
      }));
    await AppBlocker.setSchedules(payload).catch(() => {});
  } catch {
    // Best-effort; a failed push must never block the save flow.
  }
}

export default function TaskSetupScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const existingTask = route.params?.task;
  const [taskName, setTaskName] = useState(existingTask?.name || '');
  const [packageName, setPackageName] = useState(existingTask?.packageName || '');
  const [appName, setAppName] = useState(existingTask?.appName || '');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [selectedApps, setSelectedApps] = useState<InstalledApp[]>(() => {
    if (!existingTask) return [];
    if (existingTask.blockedPackages && existingTask.blockedPackages.length > 0) {
      return existingTask.blockedPackages.map(pkg => ({
        packageName: pkg,
        appName: pkg === existingTask.packageName ? existingTask.appName : pkg,
      }));
    }
    return existingTask.packageName
      ? [{ packageName: existingTask.packageName, appName: existingTask.appName }]
      : [];
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startMinutes, setStartMinutes] = useState(9 * 60);
  const [endMinutes, setEndMinutes] = useState(17 * 60);
  const [existingScheduleId, setExistingScheduleId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    AppBlocker.getInstalledApps()
      .then(apps => { if (live) setInstalledApps(apps); })
      .catch(() => { if (live) setInstalledApps([]); });
    store.getPreferences()
      .then(p => { if (live) setIsSubscribed(p.isSubscribed === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!existingTask) return;
    let live = true;
    store.getSchedulesForTask(existingTask.id)
      .then(list => {
        if (!live || list.length === 0) return;
        const s: FocusSchedule = list[0];
        setExistingScheduleId(s.id);
        setScheduleEnabled(s.enabled);
        setScheduleDays(s.days);
        setStartMinutes(s.startMinutes);
        setEndMinutes(s.endMinutes);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [existingTask?.id]);

  const filteredApps = installedApps.filter(
    (a) =>
      a.appName.toLowerCase().includes(appSearchQuery.toLowerCase()) ||
      a.packageName.toLowerCase().includes(appSearchQuery.toLowerCase()),
  );

  const handlePickApp = (app: InstalledApp) => {
    if (isSubscribed === null) return;
    const already = selectedApps.some(a => a.packageName === app.packageName);
    if (already) {
      const next = selectedApps.filter(a => a.packageName !== app.packageName);
      setSelectedApps(next);
      setPackageName(next[0]?.packageName ?? '');
      setAppName(next[0]?.appName ?? '');
      return;
    }
    // Free tier covers ONE app at a time: tapping another app asks whether to
    // replace it (keeps upsell discovery) instead of silently swapping.
    if (!isSubscribed && selectedApps.length >= 1) {
      Alert.alert(`Block "${app.appName}" instead?`, 'Free covers one app at a time. Replace it, or go Pro to block several.', [
        {
          text: 'Replace',
          onPress: () => {
            setSelectedApps([app]);
            setPackageName(app.packageName);
            setAppName(app.appName);
            setAppSearchQuery('');
          },
        },
        { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    const next = [...selectedApps, app];
    setSelectedApps(next);
    setPackageName(next[0].packageName);
    setAppName(next[0].appName);
    setAppSearchQuery('');
  };

  const isPro = isSubscribed === true;

  const showScheduleProGate = () => {
    Alert.alert('Pro feature', 'Schedules are a Pro feature. Upgrade to auto-block during focus hours.', [
      { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleToggleSchedule = () => {
    if (!isPro) { showScheduleProGate(); return; }
    setScheduleEnabled(v => !v);
  };

  const handleToggleDay = (day: number) => {
    if (!isPro) { showScheduleProGate(); return; }
    setScheduleDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]));
  };

  const adjustHour = (which: 'start' | 'end', delta: number) => {
    if (!isPro) { showScheduleProGate(); return; }
    if (which === 'start') {
      setStartMinutes(prev => {
        const h = Math.floor(prev / 60);
        return ((h + delta + 24) % 24) * 60 + (prev % 60);
      });
    } else {
      setEndMinutes(prev => {
        const h = Math.floor(prev / 60);
        return ((h + delta + 24) % 24) * 60 + (prev % 60);
      });
    }
  };

  const cycleMinute = (which: 'start' | 'end') => {
    if (!isPro) { showScheduleProGate(); return; }
    if (which === 'start') {
      setStartMinutes(prev => {
        const h = Math.floor(prev / 60);
        const idx = MINUTE_STEPS.indexOf(prev % 60);
        return h * 60 + MINUTE_STEPS[(idx + 1) % MINUTE_STEPS.length];
      });
    } else {
      setEndMinutes(prev => {
        const h = Math.floor(prev / 60);
        const idx = MINUTE_STEPS.indexOf(prev % 60);
        return h * 60 + MINUTE_STEPS[(idx + 1) % MINUTE_STEPS.length];
      });
    }
  };

  const scheduleValid = scheduleDays.length >= 1 && startMinutes !== endMinutes;
  const scheduleHint = !scheduleEnabled
    ? null
    : scheduleDays.length === 0
      ? 'Pick at least one day.'
      : startMinutes === endMinutes
        ? "Start and end can't be the same."
        : null;

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const formOpacity = useSharedValue(0);
  const formTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    formOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    formTranslateY.value = withDelay(250, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(400, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const handleSave = async () => {
    if (!taskName.trim()) return;
    // Manual override wins; otherwise use the picked app(s).
    const rawPkgs = selectedApps.length > 0
      ? selectedApps.map(a => a.packageName)
      : (packageName.trim() ? [packageName.trim()] : []);
    if (rawPkgs.length === 0) return;
    if (scheduleEnabled && isPro && !scheduleValid) return;
    // Safety net: free tier can never persist more than one blocked app
    // (e.g. legacy Pro multi-task edited after expiry).
    const pkgs = isSubscribed ? rawPkgs : rawPkgs.slice(0, 1);
    const firstApp = selectedApps.find(a => a.packageName === pkgs[0])?.appName
      || appName.trim() || pkgs[0];
    const taskId = existingTask ? existingTask.id : `task-${Date.now()}`;
    // Free tier forces the schedule off at save.
    const effectiveScheduleEnabled = isPro && scheduleEnabled;

    try {
      if (existingTask) {
        await store.saveTask({ ...existingTask, name: taskName.trim(), packageName: pkgs[0], appName: firstApp, blockedPackages: pkgs });
      } else {
        await store.saveTask({
          id: taskId,
          name: taskName.trim(),
          packageName: pkgs[0],
          appName: firstApp,
          blockedPackages: pkgs,
          createdAt: Date.now(),
          lastUsed: 0,
          useCount: 0,
          isActive: true,
          streak: 0,
        });
      }
    } catch {
      Alert.alert('Could not save task', 'Storage failed. Please try again.');
      return;
    }
    try {
      if (existingScheduleId) {
        await store.saveSchedule({
          id: existingScheduleId,
          taskId,
          days: scheduleDays,
          startMinutes,
          endMinutes,
          enabled: effectiveScheduleEnabled,
        });
      } else if (effectiveScheduleEnabled) {
        await store.saveSchedule({
          id: `sched-${Date.now()}`,
          taskId,
          days: scheduleDays,
          startMinutes,
          endMinutes,
          enabled: true,
        });
      }
    } catch {
      // Best-effort; the task itself already saved.
    }
    await syncSchedulesToNative();
    navigation.goBack();
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const formAnimStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const border = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const canSave = taskName.trim() && (selectedApps.length > 0 || packageName.trim()) && (!scheduleEnabled || !isPro || scheduleValid);

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backIcon} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeftIcon size={24} color={ink} />
          </TouchableOpacity>
          <Text style={[typography.display, { color: ink }]}>
            {existingTask ? 'EDIT TASK' : 'NEW TASK'}
          </Text>
          <View style={{ width: 60 }} />
        </View>
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.form, formAnimStyle]}>
          <Text style={[typography.display, { color: ink, marginBottom: spacing.md }]}>
            TASK NAME
          </Text>
          <View style={styles.nameRow}>
            <View style={styles.taskGlyphBox}>
              <TaskGlyph name={taskName || existingTask?.name || ''} size={22} color={colors.midnight} />
            </View>
            <TextInput
              style={[styles.input, styles.nameInput, { color: ink, backgroundColor: cardBg, borderColor: border }]}
              placeholder="e.g. Deep Work"
              placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
              value={taskName}
              onChangeText={setTaskName}
            />
          </View>

          <Text style={[typography.h3, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            INSTALLED APPS
          </Text>
          <TextInput
            style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border, marginBottom: spacing.sm }]}
            placeholder="Search apps..."
            placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
            value={appSearchQuery}
            onChangeText={setAppSearchQuery}
          />
          {filteredApps.length === 0 ? (
            <View style={styles.noAppsFound}>
              <Image source={mascotSource('thinking', isDark)} style={styles.noAppsImage} resizeMode="contain" />
              <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkMuted, paddingVertical: spacing.md, textAlign: 'center' }]}>
                No apps found
              </Text>
            </View>
          ) : (
            <View style={[styles.appList, { backgroundColor: cardBg, borderColor: border }]}>
              {filteredApps.map((app) => {
                const checked = selectedApps.some(a => a.packageName === app.packageName);
                return (
                  <TouchableOpacity
                    key={app.packageName}
                    activeOpacity={0.7}
                    onPress={() => handlePickApp(app)}
                    style={[
                      styles.appRow,
                      {
                        backgroundColor: checked
                          ? isDark
                            ? 'rgba(255,255,255,0.06)'
                            : 'rgba(28,176,246,0.08)'
                          : 'transparent',
                        borderRadius: radius.sm,
                      },
                    ]}
                  >
                    <View style={[styles.checkbox, { borderColor: border }, checked && styles.checkboxChecked]}>
                      {checked && (
                        <CheckIcon size={14} color={colors.midnight} />
                      )}
                    </View>
                    {app.iconBase64 ? (
                      <Image
                        source={{ uri: `data:image/png;base64,${app.iconBase64}` }}
                        style={styles.appIcon}
                      />
                    ) : (
                      <View style={styles.appIconFallback}>
                        <TaskGlyph name={app.appName} size={18} color={colors.midnight} />
                      </View>
                    )}
                    <View style={styles.appInfo}>
                      <Text style={[{ fontFamily: 'SpaceGrotesk-SemiBold', fontSize: 16, lineHeight: 22 }, { color: ink }]} numberOfLines={1}>
                        {app.appName}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={[typography.label, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            PACKAGE NAME (MANUAL OVERRIDE)
          </Text>
          <TextInput
            style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border }]}
            placeholder="e.g., com.instagram.android"
            placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
            value={packageName}
            onChangeText={(text) => { setPackageName(text); setAppName(''); setSelectedApps([]); }}
          />
          <Text style={[typography.h3, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            SCHEDULE{!isPro ? ' · PRO' : ''}
          </Text>
          <View style={[styles.scheduleCard, { backgroundColor: cardBg, borderColor: border }]}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleToggleSchedule}
              style={styles.scheduleToggleRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: scheduleEnabled }}
              accessibilityLabel="Enable schedule"
            >
              <View style={styles.scheduleToggleText}>
                <Text style={[{ fontFamily: 'SpaceGrotesk-SemiBold', fontSize: 16, lineHeight: 22 }, { color: ink }]}>
                  Enable schedule
                </Text>
                <Text style={[typography.caption, { color: muted, marginTop: 2 }]}>
                  Auto-block during focus hours
                </Text>
              </View>
              <View style={[styles.toggleTrack, { borderColor: border }, scheduleEnabled && styles.toggleTrackOn]}>
                <View style={[styles.toggleKnob, scheduleEnabled && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            {scheduleEnabled && (
              <>
                <View style={styles.dayRow}>
                  {DAY_ORDER.map((day, i) => {
                    const on = scheduleDays.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        activeOpacity={0.7}
                        onPress={() => handleToggleDay(day)}
                        style={[styles.dayChip, { borderColor: border }, on && styles.dayChipOn]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`Day ${day}`}
                      >
                        <Text style={[styles.dayChipText, { color: on ? colors.midnight : ink }]}>
                          {DAY_LABELS[i]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.timeRow}>
                  <Text style={[typography.label, { color: ink }]}>START</Text>
                  <View style={styles.stepperGroup}>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('start', -1)} accessibilityRole="button" accessibilityLabel="Decrease start hour">
                      <Text style={[styles.stepperText, { color: ink }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.timeText, { color: ink }]}>{formatScheduleTime(startMinutes)}</Text>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('start', 1)} accessibilityRole="button" accessibilityLabel="Increase start hour">
                      <Text style={[styles.stepperText, { color: ink }]}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.minuteBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => cycleMinute('start')} accessibilityRole="button" accessibilityLabel="Cycle start minutes">
                      <Text style={[styles.minuteText, { color: ink }]}>:{String(startMinutes % 60).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.timeRow}>
                  <Text style={[typography.label, { color: ink }]}>END</Text>
                  <View style={styles.stepperGroup}>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('end', -1)} accessibilityRole="button" accessibilityLabel="Decrease end hour">
                      <Text style={[styles.stepperText, { color: ink }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.timeText, { color: ink }]}>{formatScheduleTime(endMinutes)}</Text>
                    <TouchableOpacity style={[styles.stepperBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => adjustHour('end', 1)} accessibilityRole="button" accessibilityLabel="Increase end hour">
                      <Text style={[styles.stepperText, { color: ink }]}>+</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.minuteBtn, { borderColor: border }]} activeOpacity={0.7} onPress={() => cycleMinute('end')} accessibilityRole="button" accessibilityLabel="Cycle end minutes">
                      <Text style={[styles.minuteText, { color: ink }]}>:{String(endMinutes % 60).padStart(2, '0')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {scheduleHint && (
                  <Text style={[typography.caption, { color: colors.danger, marginTop: spacing.sm }]}>
                    {scheduleHint}
                  </Text>
                )}
              </>
            )}
          </View>
        </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: canSave ? 1 : 0.5, backgroundColor: isDark ? '#ffffff' : colors.ectoGreen, borderBottomWidth: isDark ? 0 : 3 }]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!canSave}
          onPressIn={canSave ? handlePressIn : undefined}
          onPressOut={canSave ? handlePressOut : undefined}
        >
          <Text style={styles.primaryButtonText}>SAVE TASK</Text>
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
  backIcon: {
    width: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  form: {},
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  taskGlyphBox: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nameInput: {
    flex: 1,
  },
  input: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontFamily: 'Inter-Regular',
    fontSize: typography.body.fontSize,
  },
  appList: {
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
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
  appInfo: {
    flex: 1,
  },
  noAppsFound: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  noAppsImage: {
    width: 130,
    height: 130,
  },
  scheduleCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  scheduleToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  scheduleToggleText: {
    flex: 1,
  },
  toggleTrack: {
    width: 52,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  toggleTrackOn: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: radius.full,
    backgroundColor: '#999',
    alignSelf: 'flex-start',
  },
  toggleKnobOn: {
    backgroundColor: colors.midnight,
    alignSelf: 'flex-end',
  },
  dayRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  dayChip: {
    flex: 1,
    minHeight: 44,
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayChipOn: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  dayChipText: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 16,
    lineHeight: 22,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    minHeight: 44,
  },
  stepperGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperText: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 20,
    lineHeight: 24,
  },
  timeText: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 18,
    lineHeight: 22,
    minWidth: 58,
    textAlign: 'center',
  },
  minuteBtn: {
    height: 44,
    minWidth: 52,
    paddingHorizontal: spacing.sm,
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  minuteText: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 16,
    lineHeight: 22,
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
  primaryButtonText: {
    ...typography.cta,
    color: colors.midnight,
    textAlign: 'center',
  },
});
