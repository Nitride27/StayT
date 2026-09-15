import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
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
import { Session, Task, blockedPackagesOf } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import { SwitchArrowsIcon } from '../components/icons';
import AppBlocker from '../native/AppBlocker';
import { syncWidgetNow } from '../widget/widgetSync';
import { ensureDailyReminder, cancelDailyReminder } from '../notifications/reminders';
import { tap } from '../haptics';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveSession'>;
  route: { params: { task: Task; session: Session } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function ActiveSessionScreen({ navigation, route }: Props) {
  const { task, session } = route.params;
  const { isDark } = useTheme();
  const [elapsed, setElapsed] = useState(session.startedAt ? Date.now() - session.startedAt : 0);
  // False when the service is off or startBlocking fails — blocking silently
  // doing nothing is the worst outcome, so the banner below says so loudly.
  const [blockingOk, setBlockingOk] = useState(true);
  const blockingOkRef = React.useRef(true);
  // Dynamic to screen size: fixed 220px mascots push the buttons off small screens.
  const { height: winH } = useWindowDimensions();
  const mascotSize = Math.min(220, Math.max(120, Math.floor(winH * 0.24)));

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const timerOpacity = useSharedValue(0);
  const timerScale = useSharedValue(0.9);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));

    timerOpacity.value = withDelay(250, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
    timerScale.value = withDelay(250, withSpring(1, { damping: 16, stiffness: 200 }));

    buttonOpacity.value = withDelay(550, withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }));
  }, []);

  // Timer tick
  useEffect(() => {
    const interval = setInterval(() => {
      if (session.startedAt) {
        setElapsed(Date.now() - session.startedAt);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  // Start blocking when session begins; always release on unmount
  // so a gesture-back can't leave blocking on with no session.
  // Verifies the service is actually up: without it there is no blocking
  // and no blocked screen, so show the banner instead of failing silently.
  // Polls every 5s — the OS/OEM can kill the service mid-session.
  useEffect(() => {
    let live = true;
    const mark = (ok: boolean) => {
      blockingOkRef.current = ok;
      if (live) setBlockingOk(ok);
    };
    (async () => {
      const enabled = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
      if (!live) return;
      if (!enabled) {
        mark(false);
        return;
      }
      const ok = await AppBlocker.startBlocking(blockedPackagesOf(task), task.name).catch(() => false);
      mark(ok !== false);
    })();
    // P2-1: push today's totals + last-task packages to the widget mirror.
    syncWidgetNow(task).catch(() => {});
    // A daily nudge scheduled while the app was killed could fire mid-session
    // — cancel it on mount; handleEndSession re-pairs it on the way out.
    cancelDailyReminder().catch(() => {});
    const poll = setInterval(async () => {
      const enabled = await AppBlocker.isAccessibilityServiceEnabled().catch(() => false);
      if (!live) return;
      if (!enabled) {
        mark(false);
        return;
      }
      // Service (back) on: (re-)apply the allow-list — the native list is
      // in-memory so a kill/re-enable loses it. Only call when we were
      // previously down to avoid re-pushing every 5s.
      if (!blockingOkRef.current) {
        const ok = await AppBlocker.startBlocking(blockedPackagesOf(task), task.name).catch(() => false);
        mark(ok !== false);
      }
    }, 5000);
    return () => {
      live = false;
      clearInterval(poll);
      AppBlocker.stopBlocking().catch(() => {});
    };
  }, []);

  const finishSession = async () => {
    try {
      await store.saveSession({ ...session, status: 'completed', endedAt: Date.now(), duration: Date.now() - session.startedAt });
    } finally {
      // Blocking must release even if the save failed — never trap the user.
      await AppBlocker.stopBlocking().catch(() => {});
    }
    // Slow cosmetics refresh in the background: neither TaskPicker nor
    // History reads them on mount, so never hold the transition for them.
    // (P2-1 widget mirror + N-2 daily nudge re-pair.)
    syncWidgetNow(task).catch(() => {});
    ensureDailyReminder().catch(() => {});
  };

  // SWITCH TASK ends this session and returns to the picker to start another.
  const handleSwitchTask = async () => {
    tap();
    await finishSession();
    navigation.navigate('TaskPicker');
  };

  // END SESSION ends this session and shows it logged in History.
  // replace (not navigate): History's back button must land on TaskPicker,
  // not back on this now-dead session screen.
  const handleEndSession = async () => {
    tap('medium');
    await finishSession();
    navigation.replace('History');
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const timerAnimStyle = useAnimatedStyle(() => ({
    opacity: timerOpacity.value,
    transform: [{ scale: timerScale.value }],
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
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const endBg = isDark ? '#1a1a1a' : colors.midnight;
  const endText = '#ffffff';

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {!blockingOk && (
        <View style={[styles.blockWarn, { borderColor: ink }]} accessibilityRole="alert">
          <Text style={[typography.bodyStrong, { color: ink, textAlign: 'center' }]}>
            Blocking isn't active
          </Text>
          <Text style={[typography.caption, { color: muted, textAlign: 'center', marginTop: 4 }]}>
            StayT needs the Accessibility permission or your apps won't be blocked.
          </Text>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => AppBlocker.openAccessibilitySettings()}
            style={styles.blockWarnBtn}
          >
            <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>
              RE-ENABLE SERVICE
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <Image source={mascotSource('working', isDark)} style={[styles.mascotImage, { width: mascotSize, height: mascotSize }]} resizeMode="contain" />
        <Text style={[typography.display, { color: ink, textAlign: 'center', marginTop: spacing.lg }]}>
          {task.name.toUpperCase()}
        </Text>
        {task.strict === true && (
          <View style={styles.strictBadge} accessibilityRole="text" accessibilityLabel="Strict mode on">
            <Text style={[typography.label, { color: colors.midnight }]}>STRICT</Text>
          </View>
        )}
      </Animated.View>

      <Animated.View style={[styles.timerArea, timerAnimStyle]}>
        <Text style={[typography.timerXL, { color: ink }]}>
          {formatElapsed(elapsed)}
        </Text>
        <Text style={[typography.caption, { color: muted, marginTop: spacing.sm }]}>
          Small steps build big progress.
        </Text>
      </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={styles.switchButton}
          activeOpacity={0.85}
          onPress={handleSwitchTask}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <View style={styles.switchRow}>
            <SwitchArrowsIcon size={18} color={colors.midnight} />
            <Text style={[typography.cta, { color: colors.midnight, textAlign: 'center' }]}>SWITCH TASK</Text>
          </View>
        </AnimatedTouchable>
        <TouchableOpacity activeOpacity={0.7} onPress={handleEndSession} style={[styles.endButton, { backgroundColor: endBg }]}>
          <Text style={[typography.cta, { color: endText, textAlign: 'center' }]}>
            END SESSION
          </Text>
        </TouchableOpacity>
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
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  blockWarn: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  blockWarnBtn: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.ectoGreenDark,
    borderRadius: radius.xl,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  mascotImage: {
    width: 220,
    height: 220,
  },
  strictBadge: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 2,
    borderBottomColor: colors.ectoGreenDark,
  },
  timerArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  endButton: {
    borderBottomWidth: 3,
    borderBottomColor: '#000000',
    borderRadius: radius.xl,
    paddingVertical: 18,
    marginHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  bottomSection: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  switchButton: {
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
