import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
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
import { store } from '../storage/store';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BlockedInterstitial'>;
  route: { params: { packageName: string; taskId: string; appLabel?: string } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function BlockedInterstitialScreen({ navigation, route }: Props) {
  const { packageName, taskId } = route.params;
  const { isDark } = useTheme();
  const [taskName, setTaskName] = useState<string | null>(null);
  // Label travels with the event/deep link — no per-block app-list scan.
  const [appLabel] = useState(route.params.appLabel ?? packageName);

  useEffect(() => {
    store.getTasks()
      .then(ts => setTaskName(ts.find(t => t.id === taskId)?.name ?? null))
      .catch(() => {});
  }, [taskId]);

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
    mascotScale.value = withDelay(200, withSpring(1, { damping: 10, stiffness: 150 }));
    mascotOpacity.value = withDelay(200, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));

    titleOpacity.value = withDelay(500, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    titleTranslateY.value = withDelay(500, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    subtitleOpacity.value = withDelay(650, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(950, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    button2Opacity.value = withDelay(1050, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
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
    try {
      await AppBlocker.pauseBlocking(120);
    } catch {
      // Best-effort; the break still counts locally below.
    }
    try {
      await store.saveBlockedAttempt({
        id: `blocked-${Date.now()}`,
        packageName,
        taskId,
        timestamp: Date.now(),
        action: 'override',
      });
    } catch {
      // Best-effort logging must never trap the user on this screen.
    }
    navigation.goBack();
  };

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const secondary = isDark ? darkColors.inkSecondary : colors.inkSecondary;
  const outlineText = isDark ? colors.ectoGreen : colors.ectoGreenDark;

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Mascot */}
      <Animated.View style={[styles.mascotContainer, mascotAnimStyle]}>
        <Image source={mascotSource('blocked', isDark)} style={styles.mascotImage} resizeMode="contain" />
      </Animated.View>

      {/* Title */}
      <Animated.View style={[styles.titleSection, titleAnimStyle]}>
        <Text style={[typography.display, { color: ink, textAlign: 'center' }]}>
          {taskName ? `THIS ISN'T PART OF ${taskName.toUpperCase()}` : 'STAY FOCUSED'}
        </Text>
      </Animated.View>

      {/* Subtitle */}
      <Animated.View style={[styles.subtitleSection, subtitleAnimStyle]}>
        <Text style={[typography.body, { color: secondary, textAlign: 'center' }]}>
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
          <Text style={[typography.button, { color: colors.midnight, textAlign: 'center' }]}>
            BACK TO TASK
          </Text>
        </AnimatedTouchable>

        <AnimatedTouchable
          style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText }]}
          activeOpacity={0.85}
          onPress={handleSwitchTask}
        >
          <Text style={[typography.button, { color: outlineText, textAlign: 'center' }]}>
            SWITCH TASK
          </Text>
        </AnimatedTouchable>

        <AnimatedTouchable
          style={[styles.outlineButton, button2AnimStyle, { borderColor: outlineText }]}
          activeOpacity={0.85}
          onPress={handleTakeBreak}
        >
          <Text style={[typography.button, { color: outlineText, textAlign: 'center' }]}>
            2-MIN OVERRIDE
          </Text>
        </AnimatedTouchable>
      </View>
    </View>
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
    width: 180,
    height: 180,
  },
  titleSection: {
    marginBottom: spacing.md,
  },
  subtitleSection: {
    marginBottom: spacing.xxxl,
    paddingHorizontal: spacing.md,
  },
  buttonSection: {
    width: '100%',
    gap: spacing.md,
  },
  backButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
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
});
