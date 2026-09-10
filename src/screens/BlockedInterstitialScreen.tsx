import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, gamification, layout, colors } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BlockedInterstitial'>;
  route: { params: { packageName: string; taskId: string } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function BlockedInterstitialScreen({ navigation, route }: Props) {
  const { packageName } = route.params;
  const { isDark } = useTheme();

  // Entry animations
  const overlayOpacity = useSharedValue(0);
  const shieldScale = useSharedValue(0.5);
  const shieldOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleTranslateY = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const quoteOpacity = useSharedValue(0);
  const quoteTranslateY = useSharedValue(15);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);
  const button2Opacity = useSharedValue(0);

  // Shield pulse
  const shieldPulse = useSharedValue(1);

  useEffect(() => {
    overlayOpacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });

    shieldScale.value = withDelay(200, withSpring(1, { damping: 10, stiffness: 150 }));
    shieldOpacity.value = withDelay(200, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));

    shieldPulse.value = withDelay(800, withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    ));

    titleOpacity.value = withDelay(500, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    titleTranslateY.value = withDelay(500, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    subtitleOpacity.value = withDelay(650, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));

    quoteOpacity.value = withDelay(800, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    quoteTranslateY.value = withDelay(800, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(950, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    button2Opacity.value = withDelay(1050, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const overlayAnimStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  const shieldAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shieldScale.value * shieldPulse.value }],
    opacity: shieldOpacity.value,
  }));

  const titleAnimStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleTranslateY.value }],
  }));

  const subtitleAnimStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  const quoteAnimStyle = useAnimatedStyle(() => ({
    opacity: quoteOpacity.value,
    transform: [{ translateY: quoteTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const button2AnimStyle = useAnimatedStyle(() => ({
    opacity: button2Opacity.value,
  }));

  const handleKeepFocus = () => {
    navigation.goBack();
  };

  const handleGiveIn = () => {
    navigation.goBack();
  };

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <Animated.View style={[styles.overlay, overlayAnimStyle, { backgroundColor: isDark ? 'rgba(0,0,0,0.95)' : 'rgba(0,0,0,0.9)' }]}>
      <View style={styles.container}>
        {/* Shield icon */}
        <Animated.View style={[styles.shieldContainer, shieldAnimStyle]}>
          <View style={[styles.shieldCircle, { backgroundColor: 'rgba(76, 175, 80, 0.15)' }]}>
            <View style={[styles.shieldInner, { backgroundColor: colors.ectoGreen }]}>
              <Text style={styles.shieldCheck}>✓</Text>
            </View>
          </View>
        </Animated.View>

        {/* Title */}
        <Animated.View style={[styles.titleSection, titleAnimStyle]}>
          <Text style={[typography.h1, { color: '#f5f5f5', textAlign: 'center' }]}>
            Stay Focused
          </Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.View style={[styles.subtitleSection, subtitleAnimStyle]}>
          <Text style={[typography.bodyMedium, { color: 'rgba(255,255,255,0.6)', textAlign: 'center' }]}>
            You blocked {packageName} for this task
          </Text>
        </Animated.View>

        {/* Motivational quote */}
        <Animated.View style={[styles.quoteSection, quoteAnimStyle]}>
          <Text style={[typography.bodyMedium, { color: 'rgba(255,255,255,0.8)', textAlign: 'center', fontStyle: 'italic' }]}>
            "The secret of getting ahead is getting started."
          </Text>
          <Text style={[typography.caption, { color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: spacing.xs }]}>
            — Mark Twain
          </Text>
        </Animated.View>

        {/* Buttons */}
        <View style={styles.buttonSection}>
          <AnimatedTouchable
            style={[styles.keepFocusButton, buttonAnimStyle]}
            activeOpacity={0.85}
            onPress={handleKeepFocus}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
          >
            <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>
              Keep Focusing
            </Text>
          </AnimatedTouchable>

          <AnimatedTouchable
            style={[styles.giveInButton, button2AnimStyle]}
            activeOpacity={0.85}
            onPress={handleGiveIn}
          >
            <Text style={[typography.bodyMedium, { color: 'rgba(255,255,255,0.5)', textAlign: 'center' }]}>
              Give In
            </Text>
          </AnimatedTouchable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: layout.headerPaddingTop,
    paddingBottom: layout.safeAreaBottom,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shieldContainer: {
    marginBottom: spacing.xxxl,
  },
  shieldCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shieldInner: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shieldCheck: {
    fontSize: 32,
    color: colors.midnight,
    fontWeight: '700',
  },
  titleSection: {
    marginBottom: spacing.md,
  },
  subtitleSection: {
    marginBottom: spacing.xxxl,
  },
  quoteSection: {
    marginBottom: spacing.xxxl * 1.5,
    paddingHorizontal: spacing.xl,
  },
  buttonSection: {
    width: '100%',
    gap: spacing.lg,
  },
  keepFocusButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  giveInButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
