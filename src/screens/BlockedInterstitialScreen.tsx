import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, TextInput, ScrollView, useWindowDimensions } from 'react-native';
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
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import AppBlocker from '../native/AppBlocker';
import { store, MAX_DAILY_OVERRIDES } from '../storage/store';
import { syncWidgetNow } from '../widget/widgetSync';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BlockedInterstitial'>;
  route: { params: { packageName: string; taskId: string; appLabel?: string } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function BlockedInterstitialScreen({ navigation, route }: Props) {
  const { packageName, taskId } = route.params;
  const { isDark } = useTheme();
  const [taskName, setTaskName] = useState<string | null>(null);
  // Label travels with the event/deep link — read live from params (not
  // useState) so a param merge into this mounted instance never goes stale.
  const appLabel = route.params.appLabel ?? packageName;
  const [overridesLeft, setOverridesLeft] = useState(MAX_DAILY_OVERRIDES);
  const [taskStrict, setTaskStrict] = useState(false);
  // M3 fail-closed: while the task lookup is in flight (taskId non-empty),
  // both escape buttons stay hidden — a strict task must never flash them.
  const [taskLoaded, setTaskLoaded] = useState(taskId ? false : true);
  // P1-2 escalating friction: override unlocks after a wait that grows with
  // today's consumption (0/30/90s). Strict tasks skip the path entirely.
  const [countdown, setCountdown] = useState(0);
  // P1-3 intention break form state (FREE, consumes one override unit).
  const [breakOpen, setBreakOpen] = useState(false);
  const [intention, setIntention] = useState('');
  const [breakMinutes, setBreakMinutes] = useState(10);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    store.getTasks()
      .then(ts => {
        if (!live) return;
        const t = ts.find(x => x.id === taskId);
        setTaskName(t?.name ?? null);
        setTaskStrict(t?.strict === true);
        setTaskLoaded(true);
      })
      .catch(() => { if (live) setTaskLoaded(true); });
    store.getOverridesUsedToday()
      .then(used => { if (live) setOverridesLeft(Math.max(0, MAX_DAILY_OVERRIDES - used)); })
      .catch(() => {});
    store.getOverrideWaitSeconds()
      .then(wait => { if (live) setCountdown(wait); })
      .catch(() => {});
    return () => { live = false; };
  }, [taskId]);

  // Live override countdown (M:SS) while it is still locked.
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  // Entry animations
  const mascotScale = useSharedValue(0.5);
  const mascotOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);
  const button2Opacity = useSharedValue(0);

  useEffect(() => {
    mascotScale.value = withDelay(200, withSpring(1, { damping: 16, stiffness: 150 }));
    mascotOpacity.value = withDelay(200, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));

    titleOpacity.value = withDelay(500, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    titleTranslateY.value = withDelay(500, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    subtitleOpacity.value = withDelay(650, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(950, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    button2Opacity.value = withDelay(1050, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  const mascotAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: mascotScale.value }],
    opacity: mascotOpacity.value,
  }));

  const titleAnimStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));

  const subtitleAnimStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const button2AnimStyle = useAnimatedStyle(() => ({
    opacity: button2Opacity.value,
  }));

  const handleBackToTask = () => {
    navigation.goBack();
  };

  const handleSwitchTask = () => {
    // Session stays active; user picks a different task to focus on.
    navigation.navigate('TaskPicker');
  };

  const handleTakeBreak = async () => {
    // Single consume path: atomic check-and-increment. A double-tap (or a
    // concurrent overlay tap) can never burn two units or exceed the cap.
    // M3: strict tasks never reach here (buttons hidden + this guard).
    if (countdown > 0 || busy || taskStrict) return;
    setBusy(true);
    let left = overridesLeft;
    try {
      const consumed = await store.tryConsumeOverride();
      if (consumed.result === 'exhausted') {
        setOverridesLeft(0);
        setBusy(false);
        return;
      }
      left = consumed.left;
    } catch {
      // Best-effort counting must never trap the user on this screen.
    }
    setOverridesLeft(left);
    try {
      await AppBlocker.pauseBlocking(120);
    } catch {
      // Best-effort; the break still counts locally below.
    }
    try {
      // M1: the entry give_in for this block becomes the override record.
      await store.deleteLatestGiveIn(packageName).catch(() => {});
      await store.saveBlockedAttempt({
        id: `blocked-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        packageName,
        taskId,
        timestamp: Date.now(),
        action: 'override',
      });
    } catch {
      // Best-effort logging must never trap the user on this screen.
    }
    // B1: the budget changed — re-push the tile/widget mirror.
    syncWidgetNow().catch(() => {});
    setBusy(false);
    navigation.goBack();
  };

  // P1-3 intention break: inline form -> pauseBlocking(min*60) + a 'break'
  // attempt that consumes one override unit (said so in the UI). Strict
  // tasks never reach here (form hidden).
  const handleStartBreak = async () => {
    // M2: intention breaks wait out the same escalating friction as overrides.
    if (busy || taskStrict || countdown > 0) return;
    setBusy(true);
    let left = overridesLeft;
    try {
      const consumed = await store.tryConsumeOverride();
      if (consumed.result === 'exhausted') {
        setOverridesLeft(0);
        setBusy(false);
        return;
      }
      left = consumed.left;
    } catch {
      // Best-effort counting must never trap the user on this screen.
    }
    setOverridesLeft(left);
    try {
      await AppBlocker.pauseBlocking(breakMinutes * 60);
    } catch {
      // Best-effort; the break still counts locally below.
    }
    try {
      // M1: the entry give_in for this block becomes the break record.
      await store.deleteLatestGiveIn(packageName).catch(() => {});
      await store.saveBlockedAttempt({
        id: `blocked-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        packageName,
        taskId,
        timestamp: Date.now(),
        action: 'break',
        intention: intention.trim() || undefined,
        breakMinutes,
      });
    } catch {
      // Best-effort logging must never trap the user on this screen.
    }
    // B1: the budget changed — re-push the tile/widget mirror.
    syncWidgetNow().catch(() => {});
    setBusy(false);
    navigation.goBack();
  };

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 16, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 16, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const secondary = isDark ? darkColors.inkSecondary : colors.inkSecondary;
  const outlineText = isDark ? colors.ectoGreen : colors.ectoGreenDark;
  // Dynamic to screen size: fixed 220px mascots overflow small screens.
  const { height: winH } = useWindowDimensions();
  const mascotSize = Math.min(220, Math.max(120, Math.floor(winH * 0.22)));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={[styles.container, { backgroundColor: bg, flexGrow: 1 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Mascot */}
      <Animated.View style={[styles.mascotContainer, mascotAnimStyle]}>
        <Image source={mascotSource('blocked', isDark)} style={[styles.mascotImage, { width: mascotSize, height: mascotSize }]} resizeMode="contain" />
      </Animated.View>

      {/* Title */}
      <Animated.View style={[styles.titleSection, titleAnimStyle]}>
        <Text style={[typography.display, { color: ink, textAlign: 'center' }]}>
          {taskName ? `THIS ISN'T PART OF ${taskName.toUpperCase()}` : 'STAY FOCUSED'}
        </Text>
      </Animated.View>

      {/* Subtitle */}
      <Animated.View style={[styles.subtitleSection, subtitleAnimStyle]}>
        <Text style={[typography.bodyStrong, { color: secondary, textAlign: 'center', maxWidth: 280, alignSelf: 'center' }]}>
          {`You're trying to open ${appLabel}, but that's not part of your current task.`}
        </Text>
      </Animated.View>

      {/* Buttons */}
      <View style={styles.buttonSection}>
        <AnimatedTouchable
          style={[styles.backButton, buttonAnimStyle]}
          activeOpacity={0.85}
          onPress={handleBackToTask}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
            BACK TO TASK
          </Text>
        </AnimatedTouchable>

        <AnimatedTouchable
          style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText }]}
          activeOpacity={0.85}
          onPress={handleSwitchTask}
        >
          <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
            SWITCH TASK
          </Text>
        </AnimatedTouchable>

        {taskStrict ? (
          <Animated.View style={[styles.strictBox, button2AnimStyle, { borderColor: outlineText }]}>
            <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
              STRICT MODE — NO OVERRIDES
            </Text>
            <Text style={[typography.caption, { color: secondary, textAlign: 'center', marginTop: 6 }]}>
              This task locks you in. Get back to work.
            </Text>
          </Animated.View>
        ) : !taskLoaded ? null : (
          <>
            <AnimatedTouchable
              style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText, opacity: overridesLeft > 0 && countdown <= 0 ? 1 : 0.5 }]}
              activeOpacity={0.85}
              onPress={handleTakeBreak}
              disabled={overridesLeft <= 0 || countdown > 0 || busy}
            >
              <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
                {overridesLeft <= 0
                  ? 'OVERRIDES USED UP'
                  : countdown > 0
                    ? `OVERRIDE UNLOCKS IN ${formatCountdown(countdown)}`
                    : `2-MIN OVERRIDE (${overridesLeft} LEFT)`}
              </Text>
            </AnimatedTouchable>

            <AnimatedTouchable
              style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText, opacity: overridesLeft > 0 && countdown <= 0 ? 1 : 0.5 }]}
              activeOpacity={0.85}
              onPress={() => setBreakOpen(v => !v)}
              disabled={overridesLeft <= 0 || countdown > 0}
            >
              <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
                TAKE AN INTENTION BREAK
              </Text>
            </AnimatedTouchable>

            {breakOpen && overridesLeft > 0 && countdown <= 0 && (
              <Animated.View style={[styles.breakCard, button2AnimStyle, { borderColor: outlineText }]}>
                <Text style={[typography.bodyMedium, { color: ink, textAlign: 'center' }]}>
                  {`Break from ${appLabel}`}
                </Text>
                <TextInput
                  style={[styles.breakInput, { color: ink, borderColor: outlineText }]}
                  placeholder="What will you do on this break?"
                  placeholderTextColor={secondary}
                  value={intention}
                  onChangeText={setIntention}
                  maxLength={140}
                />
                <View style={styles.chipRow}>
                  {[5, 10, 15].map(m => (
                    <TouchableOpacity
                      key={m}
                      activeOpacity={0.7}
                      onPress={() => setBreakMinutes(m)}
                      style={[styles.chip, { borderColor: outlineText }, breakMinutes === m && styles.chipOn]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: breakMinutes === m }}
                      accessibilityLabel={`${m} minute break`}
                    >
                      <Text style={[typography.button, { color: breakMinutes === m ? colors.midnight : outlineText }]}>
                        {`${m} MIN`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleStartBreak}
                  disabled={busy || countdown > 0}
                  style={[styles.breakGo, { opacity: busy || countdown > 0 ? 0.5 : 1 }]}
                >
                  <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
                    {countdown > 0
                      ? `BREAK UNLOCKS IN ${formatCountdown(countdown)}`
                      : `START ${breakMinutes}-MIN BREAK (USES 1 OVERRIDE)`}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: layout.headerPaddingTop,
    paddingBottom: layout.safeAreaBottom,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mascotContainer: {
    marginBottom: spacing.xl,
  },
  mascotImage: {
    width: 220,
    height: 220,
  },
  titleSection: {
    marginBottom: spacing.md,
  },
  subtitleSection: {
    marginBottom: spacing.xxxl,
    paddingHorizontal: spacing.md,
    maxWidth: 320,
    alignSelf: 'center',
    alignItems: 'center',
  },
  buttonSection: {
    width: '100%',
    gap: spacing.md,
  },
  backButton: {
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
  outlineButton: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  strictBox: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  breakCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  breakInput: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
    fontFamily: 'Inter-Regular',
    fontSize: typography.body.fontSize,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  chipOn: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  breakGo: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
