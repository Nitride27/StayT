import React, { useEffect, useState } from 'react';
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
import { useIAP, type Purchase } from 'expo-iap';
import { PRO_SKU, grantPro } from '../billing/pro';

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
        <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>{feature.title}</Text>
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
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const grantAndClose = async (purchase?: Purchase) => {
    try {
      // Unfinished purchases auto-refund on Android — always finish after grant.
      if (purchase) await finishTransaction({ purchase, isConsumable: false });
      await grantPro();
      navigation.goBack();
    } catch {
      setStoreError('Purchase went through but activation failed. Tap Restore Purchase.');
    } finally {
      setBusy(false);
    }
  };

  const {
    connected,
    products,
    availablePurchases,
    fetchProducts,
    requestPurchase,
    getAvailablePurchases,
    finishTransaction,
  } = useIAP({
    onPurchaseSuccess: (purchase) => { void grantAndClose(purchase); },
    onPurchaseError: (e) => {
      setBusy(false);
      if (e.code !== 'user-cancelled') setStoreError(e.message);
    },
  });

  useEffect(() => {
    if (connected) fetchProducts({ skus: [PRO_SKU] }).catch(() => {});
  }, [connected]);

  // Restore resolves via availablePurchases state after getAvailablePurchases().
  useEffect(() => {
    if (!restoring) return;
    setRestoring(false);
    setBusy(false);
    const owned = availablePurchases.find(p => p.productId === PRO_SKU);
    if (owned) {
      setBusy(true);
      void grantAndClose(owned);
    } else {
      setStoreError('No previous purchase found for this account.');
    }
  }, [availablePurchases]);

  const price = products.find(p => p.id === PRO_SKU)?.displayPrice ?? '$4.99';

  const handleUnlock = async () => {
    setStoreError(null);
    if (!connected) {
      setStoreError('Store unavailable. Check your connection and reopen this screen.');
      return;
    }
    setBusy(true);
    try {
      await requestPurchase({ request: { google: { skus: [PRO_SKU] } }, type: 'in-app' });
    } catch (e) {
      setBusy(false);
      setStoreError(e instanceof Error ? e.message : 'Purchase could not start.');
    }
  };

  const handleRestore = async () => {
    setStoreError(null);
    if (!connected) {
      setStoreError('Store unavailable. Check your connection and reopen this screen.');
      return;
    }
    setBusy(true);
    setRestoring(true);
    try {
      await getAvailablePurchases();
    } catch {
      setRestoring(false);
      setBusy(false);
      setStoreError('Restore failed. Check your connection and try again.');
    }
  };

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
        <Text style={[typography.display, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center' }]}>
          UNLOCK FULL POWER
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
        {storeError && (
          <Text style={[typography.caption, { color: colors.danger, textAlign: 'center', marginBottom: spacing.md }]}>
            {storeError}
          </Text>
        )}
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: busy ? 0.6 : 1 }]}
          activeOpacity={0.85}
          onPress={handleUnlock}
          disabled={busy}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>
            {busy ? 'Processing…' : `Unlock Pro — ${price}`}
          </Text>
        </AnimatedTouchable>

        <TouchableOpacity style={[styles.restoreButton, { borderColor: colors.ectoGreen }]} activeOpacity={0.7} onPress={handleRestore} disabled={busy}>
          <Text style={[typography.label, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center' }]}>
            RESTORE PURCHASE
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
    borderRadius: radius.md,
    borderWidth: 2,
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
    borderRadius: radius.md,
    borderWidth: 2,
    marginTop: spacing.md,
  },
});
