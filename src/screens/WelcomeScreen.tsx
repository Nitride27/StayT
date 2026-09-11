import React, { useEffect } from 'react';
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

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Welcome'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function WelcomeScreen({ navigation }: Props) {
  const { isDark } = useTheme();

  // Entry animations
  const heroOpacity = useSharedValue(0);
  const heroTranslateY = useSharedValue(20);
  const feature1Opacity = useSharedValue(0);
  const feature1TranslateY = useSharedValue(20);
  const feature2Opacity = useSharedValue(0);
  const feature2TranslateY = useSharedValue(20);
  const feature3Opacity = useSharedValue(0);
  const feature3TranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonTranslateY = useSharedValue(20);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    heroOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    heroTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    feature1Opacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    feature1TranslateY.value = withDelay(250, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    feature2Opacity.value = withDelay(350, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    feature2TranslateY.value = withDelay(350, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    feature3Opacity.value = withDelay(450, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    feature3TranslateY.value = withDelay(450, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(600, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    buttonTranslateY.value = withDelay(600, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const heroAnimStyle = useAnimatedStyle(() => ({
    opacity: heroOpacity.value,
    transform: [{ translateY: heroTranslateY.value }],
  }));

  const feature1AnimStyle = useAnimatedStyle(() => ({
    opacity: feature1Opacity.value,
    transform: [{ translateY: feature1TranslateY.value }],
  }));

  const feature2AnimStyle = useAnimatedStyle(() => ({
    opacity: feature2Opacity.value,
    transform: [{ translateY: feature2TranslateY.value }],
  }));

  const feature3AnimStyle = useAnimatedStyle(() => ({
    opacity: feature3Opacity.value,
    transform: [{ translateY: feature3TranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ translateY: buttonTranslateY.value }, { scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000000' : colors.paper }]}>
      <View style={styles.topSection}>
        <Animated.View style={[styles.heroArea, heroAnimStyle]}>
          {/* Mascot */}
          <Image source={mascotSource('waving', isDark)} style={styles.mascotImage} resizeMode="contain" />
          <Text style={[typography.display, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center', marginTop: spacing.xl }]}>
            STAY FOCUSED.
          </Text>
          <Text style={[typography.display, { color: colors.ectoGreen, textAlign: 'center', marginTop: spacing.xs }]}>
            STAY ON TRACK.
          </Text>
        </Animated.View>

        <View style={styles.features}>
          <Animated.View style={[styles.featureRow, feature1AnimStyle, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <View style={[styles.featureDot, { backgroundColor: colors.ectoGreen }]} />
            <View style={styles.featureText}>
              <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>Set your focus</Text>
              <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>Pick one app to block during deep work</Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.featureRow, feature2AnimStyle, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <View style={[styles.featureDot, { backgroundColor: colors.fire }]} />
            <View style={styles.featureText}>
              <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>Build your streak</Text>
              <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>Each day you resist builds your streak</Text>
            </View>
          </Animated.View>

          <Animated.View style={[styles.featureRow, feature3AnimStyle, { borderColor: isDark ? darkColors.ink : colors.ink }]}>
            <View style={[styles.featureDot, { backgroundColor: colors.macawBlue }]} />
            <View style={styles.featureText}>
              <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>Stay in the zone</Text>
              <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>One-tap redirect keeps you on task</Text>
            </View>
          </Animated.View>
        </View>
      </View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('PermissionSetup')}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={styles.primaryButtonText}>GET STARTED</Text>
        </AnimatedTouchable>

        <Text style={[typography.caption, { color: colors.inkMuted, textAlign: 'center', marginTop: spacing.md }]}>
          Takes 30 seconds to set up
        </Text>
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
  topSection: {
    flex: 1,
    justifyContent: 'center',
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  mascotImage: {
    width: 160,
    height: 160,
  },
  features: {
    gap: spacing.xl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  featureDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  featureText: {
    flex: 1,
  },
  bottomSection: {
    paddingBottom: spacing.xl,
  },
  primaryButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.midnight,
    textAlign: 'center',
  },
});
