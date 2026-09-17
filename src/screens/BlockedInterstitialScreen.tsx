import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, TextInput, ScrollView, useWindowDimensions, KeyboardAvoidingView, Platform } from 'react-native';
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
import { isEffectiveStrict } from '../types';
import { syncWidgetNow } from '../widget/widgetSync';
import { tap } from '../haptics';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BlockedInterstitial'>;
  route: { params: { packageName: string; taskId: string; appLabel?: string } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function BlockedInterstitialScreen({ navigation, route }: Props) {
  // Params always ride the navigate() call in App.tsx, but a process-death
  // restore can recreate this screen without them — default so the screen
  // fail-closes (taskLoaded gate hides escapes) instead of throwing on read.
  const { packageName = '', taskId = '' } = route.params ?? {};
  const { isDark } = useTheme();
  const [taskName, setTaskName] = useState<string | null>(null);
  // Label travels with the event/deep link — read live from params (not
  // useState) so a param merge into this mounted instance never goes stale.
  const appLabel = route.params?.appLabel ?? packageName;
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
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [busy, setBusy] = useState(false);
  // Wave 2C2 soft-friction display (FREE 10s breathe). When
  // prefs.frictionEnabled, BACK/SWITCH stay gated behind a breathe
  // countdown. Strict tasks still show it (delays entry only; strict
  // overrides stay hidden via the existing taskStrict guard below).
  const [frictionEnabled, setFrictionEnabled] = useState(false);
  const [frictionRemaining, setFrictionRemaining] = useState(0);
  // Dumbphone forces strict: same locked UI as Task.strict, still
  // non-consequential (no consume, no logging — gated separately below).
  // Resolved from the TASK's dumbphoneMode, never global prefs.
  const [dumfound, setDumfound] = useState(false);
  const effectiveStrict = isEffectiveStrict(taskStrict, dumfound);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let live = true;
    // No-overlay (ADR-0005): native no-op shim — kept so this seam never
    // breaks; resolves true with zero native side effects.
    // Deps include packageName: a replace() with a new package reuses this
    // mounted instance, and the previous block's overlay must drop too.
    AppBlocker.dismissBlockedOverlay().catch(() => {});
    store.getTasks()
      .then(ts => {
        if (!live) return;
        const t = ts.find(x => x.id === taskId);
        setTaskName(t?.name ?? null);
        setTaskStrict(t?.strict === true);
        setDumfound(t?.dumbphoneMode === true);
        setTaskLoaded(true);
      })
      .catch(() => { if (live) setTaskLoaded(true); });
    store.getOverridesUsedToday()
      .then(used => { if (live) setOverridesLeft(Math.max(0, MAX_DAILY_OVERRIDES - used)); })
      .catch(() => {});
    store.getOverrideWaitSeconds()
      .then(wait => { if (live) setCountdown(wait); })
      .catch(() => {});
    // Wave 2C2: friction prefs read (best-effort, never traps). Enabled +
    // delay > 0 → breathe gate; delay 0 or read failure → no friction UI.
    // Absent delay defaults to 10 (matches UserPreferences contract).
    store.getPreferences()
      .then(p => {
        if (!live) return;
        const delay = p.frictionDelaySeconds ?? 10;
        if (p.frictionEnabled === true && delay > 0) {
          setFrictionEnabled(true);
          setFrictionRemaining(delay);
        }
      })
      .catch(() => {});
    return () => { live = false; };
  }, [taskId, packageName]);

  // Live override countdown (M:SS) while it is still locked.
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [countdown]);

  // Wave 2C2 friction breathe countdown. Cleanup on unmount via
  // clearInterval. Never auto-dismisses — the user must still choose.
  useEffect(() => {
    if (frictionRemaining <= 0) return;
    const id = setInterval(() => setFrictionRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(id);
  }, [frictionRemaining]);

  // When the intention form opens, its START button can sit below the fold
  // on small screens. Nudge the scroll to the end so it stays reachable.
  useEffect(() => {
    if (!breakOpen) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(t);
  }, [breakOpen]);

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
    tap();
    // Wave 2C2 note: BlockedAttempt.action 'friction_pass' is owned by the
    // backend agent (types.ts). Logging is intentionally skipped here rather
    // than cast defensively — see return notes.
    navigation.goBack();
  };

  const handleSwitchTask = () => {
    tap();
    // Wave 2C2: no friction_pass log here either (backend-owned type).
    // Session stays active; user picks a different task to focus on.
    // replace (not navigate): pushing another TaskPicker lets system BACK
    // land on this stale interstitial; replacing keeps BACK on the live
    // session underneath.
    navigation.replace('TaskPicker');
  };

  const handleTakeBreak = async () => {
    // Single consume path: atomic check-and-increment. A double-tap (or a
    // concurrent overlay tap) can never burn two units or exceed the cap.
    // M3: strict tasks never reach here (buttons hidden + this guard).
    if (countdown > 0 || busy || effectiveStrict) return;
    tap();
    setBusy(true);
    let left = overridesLeft;
    // Dumfound: the escape still pauses blocking below, but consumes no
    // override unit and logs nothing (non-consequential). There is also no
    // entry give_in to replace (App.tsx skips it), so logging here would
    // corrupt an unrelated earlier row via deleteLatestGiveIn.
    if (!dumfound) {
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
    }
    setOverridesLeft(left);
    try {
      await AppBlocker.pauseBlocking(120);
    } catch {
      // Best-effort; the break still counts locally below.
    }
    if (!dumfound) {
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
    }
    // B1: the budget changed — re-push the tile/widget mirror.
    syncWidgetNow().catch(() => {});
    setBusy(false);
    navigation.goBack();
  };

  // P1-3 intention break: inline form -> pauseBlocking(min*60) + a 'break'
  // attempt that consumes one override unit (said so in the UI). Strict
  // tasks never reach here (form hidden). Breaks skip the escalating
  // friction wait by design — only the instant override waits it out.
  const handleStartBreak = async () => {
    if (busy || effectiveStrict) return;
    tap('medium');
    setBusy(true);
    let left = overridesLeft;
    // Dumfound: same non-consequential rule as the instant override above.
    if (!dumfound) {
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
    }
    setOverridesLeft(left);
    try {
      await AppBlocker.pauseBlocking(breakMinutes * 60);
    } catch {
      // Best-effort; the break still counts locally below.
    }
    if (!dumfound) {
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
    }
    // B1: the budget changed — re-push the tile/widget mirror.
    syncWidgetNow().catch(() => {});
    setBusy(false);
    navigation.goBack();
  };

  const formatCountdown = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // Wave 2C2: while true, BACK/SWITCH stay disabled behind the breathe gate.
  const frictionActive = frictionEnabled && frictionRemaining > 0;

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
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  // Dynamic to screen size: fixed 220px mascots overflow small screens.
  const { height: winH } = useWindowDimensions();
  const mascotSize = Math.min(220, Math.max(120, Math.floor(winH * 0.22)));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={[styles.container, { backgroundColor: bg }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
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
          {`${appLabel} is not part of this task.`}
        </Text>
      </Animated.View>

      {/* Wave 2C2 friction breath header (additive): only when the
          friction toggle is on. Label reads live from route.params above,
          so a param merge never goes stale. */}
      {frictionEnabled && (
        <View
          style={[styles.frictionCard, { borderColor: outlineText }]}
          accessibilityRole="text"
          accessibilityLabel={
            frictionActive
              ? `Take a breath. ${frictionRemaining} seconds remaining.`
              : 'You waited it out. Your choice.'
          }
        >
          <Text style={[typography.bodyStrong, { color: ink, textAlign: 'center' }]}>
            {`Take a breath. Do you actually need to open ${appLabel} right now?`}
          </Text>
          <Text style={[typography.displaySmall, { color: outlineText, textAlign: 'center', marginTop: 6 }]}>
            {frictionActive ? `BREATHE… ${frictionRemaining}s` : 'YOUR CHOICE'}
          </Text>
        </View>
      )}

      {/* Buttons */}
      <View style={styles.buttonSection}>
        <AnimatedTouchable
          style={[styles.backButton, buttonAnimStyle, frictionActive && { opacity: 0.5 }]}
          activeOpacity={0.85}
          onPress={handleBackToTask}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={frictionActive}
          accessibilityRole="button"
          accessibilityLabel={frictionActive ? `Breathe. ${frictionRemaining} seconds remaining.` : 'Back to task'}
        >
          <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
            {frictionActive ? `BREATHE… ${frictionRemaining}s` : 'BACK TO TASK'}
          </Text>
        </AnimatedTouchable>

        <AnimatedTouchable
          style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText }, frictionActive && { opacity: 0.5 }]}
          activeOpacity={0.85}
          onPress={handleSwitchTask}
          disabled={frictionActive}
          accessibilityRole="button"
          accessibilityLabel={frictionActive ? `Breathe. ${frictionRemaining} seconds remaining.` : 'Switch task'}
        >
          <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
            {frictionActive ? `BREATHE… ${frictionRemaining}s` : 'SWITCH TASK'}
          </Text>
        </AnimatedTouchable>

        {effectiveStrict ? (
          <Animated.View style={[styles.strictBox, button2AnimStyle, { borderColor: outlineText }]}>
            <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
              STRICT MODE: NO OVERRIDES
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
              style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText, opacity: overridesLeft > 0 ? 1 : 0.5 }]}
              activeOpacity={0.85}
              onPress={() => { tap(); setBreakOpen(v => !v); }}
              disabled={overridesLeft <= 0}
            >
              <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
                TAKE AN INTENTION BREAK
              </Text>
            </AnimatedTouchable>

            {breakOpen && overridesLeft > 0 && (
              <Animated.View
                style={[styles.breakCard, button2AnimStyle, { backgroundColor: 'transparent', borderColor: outlineText }]}
                onLayout={() => scrollRef.current?.scrollToEnd({ animated: true })}
              >
                <Text style={[typography.cta, { color: outlineText, textAlign: 'center' }]}>
                  {`Break from ${appLabel}`.toUpperCase()}
                </Text>
                <Text style={[typography.label, { color: secondary }]}>
                  WHAT WILL YOU DO ON THIS BREAK?
                </Text>
                <TextInput
                  style={[styles.breakInput, { color: ink, backgroundColor: cardBg, borderColor: outlineText }]}
                  placeholder="Stretch, water, fresh air"
                  placeholderTextColor={secondary}
                  value={intention}
                  onChangeText={setIntention}
                  maxLength={140}
                />
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => { tap(); setBreakMinutes(m => Math.max(1, m - 1)); }}
                    style={[styles.stepperBtn, { borderColor: outlineText }]}
                    accessibilityRole="button"
                    accessibilityLabel="Shorter break"
                  >
                    <Text style={[typography.cta, { color: outlineText }]}>−</Text>
                  </TouchableOpacity>
                  <Text style={[typography.cta, { color: outlineText }]}>{`${breakMinutes} MIN`}</Text>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => { tap(); setBreakMinutes(m => Math.min(60, m + 1)); }}
                    style={[styles.stepperBtn, { borderColor: outlineText }]}
                    accessibilityRole="button"
                    accessibilityLabel="Longer break"
                  >
                    <Text style={[typography.cta, { color: outlineText }]}>+</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleStartBreak}
                  disabled={busy}
                  style={[styles.breakGo, { opacity: busy ? 0.5 : 1 }]}
                >
                  <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
                    {`START ${breakMinutes}-MIN BREAK (USES 1 OVERRIDE)`}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}
          </>
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
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
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    maxWidth: 320,
    alignSelf: 'center',
    alignItems: 'center',
  },
  buttonSection: {
    width: '100%',
    gap: spacing.md,
  },
  // Wave 2C2 friction breath card (additive, existing tokens only).
  frictionCard: {
    width: '100%',
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    alignItems: 'center',
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
    paddingVertical: 18,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.xl,
    borderWidth: 2,
  },
  strictBox: {
    backgroundColor: 'transparent',
    paddingVertical: 18,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  breakCard: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginHorizontal: spacing.md,
    gap: spacing.md,
  },
  breakInput: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    minHeight: 44,
    ...typography.body,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stepperBtn: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  breakGo: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
