import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
import { typography, spacing, radius, layout, colors } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Paywall'>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const FREE_TASK_LIMIT = 3;

function AnimatedFeatureItem({ feature, index, isDark }: { feature: typeof features[number]; index: number; isDark: boolean }) {
  const delay = 550 + index * 100;
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(15);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.featureRow, animStyle]}>
      <View style={[styles.featureDot, { backgroundColor: feature.color }]} />
      <View style={styles.featureInfo}>
        <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight, fontWeight: '500' }]}>{feature.title}</Text>
        <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}>{feature.desc}</Text>
      </View>
    </Animated.View>
  );
}

const features = [
  { title: 'Unlimited Tasks', desc: 'Block as many apps as you need', color: colors.ectoGreen },
  { title: 'Scheduling', desc: 'Auto-block during focus hours', color: colors.macawBlue },
  { title: 'Advanced Stats', desc: 'Track your productivity over time', color: colors.gold },
];

export default function PaywallScreen({ navigation }: Props) {
  const { isDark } = useTheme();

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const cardOpacity = useSharedValue(0);
  const cardTranslateY = useSharedValue(20);
  const featuresOpacity = useSharedValue(0);
  const featuresTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    cardOpacity.value = withDelay(300, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    cardTranslateY.value = withDelay(300, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    featuresOpacity.value = withDelay(500, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    featuresTranslateY.value = withDelay(500, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(700, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const cardAnimStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ translateY: cardTranslateY.value }],
  }));

  const featuresAnimStyle = useAnimatedStyle(() => ({
    opacity: featuresOpacity.value,
    transform: [{ translateY: featuresTranslateY.value }],
  }));

  const buttonAnimStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000000' : colors.paper }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.closeButton}>
          <Text style={[typography.bodyMedium, { color: colors.inkMuted }]}>✕</Text>
        </TouchableOpacity>
        <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center' }]}>
          Unlock Full Power
        </Text>
      </Animated.View>

      <Animated.View style={[styles.pricingCard, cardAnimStyle, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}>
        <Text style={[typography.h2, { color: colors.ectoGreen, textAlign: 'center' }]}>Pro</Text>
        <Text style={[typography.bodyMedium, { color: isDark ? colors.inkMuted : colors.inkSecondary, textAlign: 'center', marginTop: spacing.xs }]}>
          One-time purchase
        </Text>
        <View style={styles.priceRow}>
          <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight }]}>$4.99</Text>
          <Text style={[typography.bodyMedium, { color: isDark ? colors.inkMuted : colors.inkSecondary }]}> forever</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.features, featuresAnimStyle]}>
        {features.map((f, i) => (
          <AnimatedFeatureItem key={f.title} feature={f} index={i} isDark={isDark} />
        ))}
      </Animated.View>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton]}
          activeOpacity={0.85}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>
            Unlock Pro — $4.99
          </Text>
        </AnimatedTouchable>

        <TouchableOpacity style={styles.restoreButton} activeOpacity={0.7}>
          <Text style={[typography.bodyMedium, { color: isDark ? colors.inkMuted : colors.inkSecondary, textAlign: 'center' }]}>
            Restore Purchase
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
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  closeButton: {
    alignSelf: 'flex-end',
    marginBottom: spacing.xl,
  },
  pricingCard: {
    padding: spacing.xl,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.xxl,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'baseline',
    marginTop: spacing.md,
  },
  features: {
    gap: spacing.lg,
    marginBottom: spacing.xxl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  featureDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  featureInfo: {
    flex: 1,
    gap: 2,
  },
  bottomSection: {
    marginTop: 'auto',
    paddingTop: spacing.lg,
  },
  primaryButton: {
    backgroundColor: colors.ectoGreen,
    borderBottomWidth: 3,
    borderBottomColor: colors.eelDarkBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  restoreButton: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
});
