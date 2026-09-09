import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors } from '../theme/tokens';
import { store } from '../storage/store';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Paywall'>;
};

const FREE_TASK_LIMIT = 1;

export default function PaywallScreen({ navigation }: Props) {
  const { colors: themeColors } = useTheme();

  const handleSubscribe = async () => {
    const prefs = await store.getPreferences();
    await store.savePreferences({ ...prefs, isSubscribed: true });
    navigation.goBack();
  };

  const handleRestore = async () => {
    const prefs = await store.getPreferences();
    await store.savePreferences({ ...prefs, isSubscribed: true });
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.paper }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.icon, { color: colors.gold }]}>🔓</Text>
          <Text style={[typography.h1, { color: themeColors.ink, marginTop: spacing.lg }]}>
            Unlock More Tasks
          </Text>
          <Text style={[typography.bodyMedium, { color: themeColors.inkSecondary, marginTop: spacing.md, textAlign: 'center' }]}>
            You've reached the free limit of {FREE_TASK_LIMIT} task.
          </Text>
          <Text style={[typography.body, { color: themeColors.inkMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
            Subscribe to create unlimited tasks and block more distracting apps.
          </Text>
        </View>

        <View style={styles.features}>
          {[
            { icon: '🎯', title: 'Unlimited Tasks', desc: 'Create as many focus tasks as you need' },
            { icon: '📊', title: 'Advanced Analytics', desc: 'Detailed session history and streaks' },
            { icon: '⚡', title: 'Priority Support', desc: 'Get help when you need it' },
          ].map((feature, i) => (
            <View key={i} style={[styles.featureRow, { backgroundColor: themeColors.paperCard, borderColor: themeColors.paperBorder }]}>
              <Text style={styles.featureIcon}>{feature.icon}</Text>
              <View style={styles.featureText}>
                <Text style={[typography.bodyBold, { color: themeColors.ink }]}>{feature.title}</Text>
                <Text style={[typography.caption, { color: themeColors.inkMuted }]}>{feature.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.pricing}>
          <View style={[styles.priceCard, { backgroundColor: colors.ectoGreen, borderColor: colors.eelDarkBlue, borderBottomWidth: 3 }]}>
            <Text style={[typography.bodyBold, { color: colors.eelDarkBlue }]}>MONTHLY</Text>
            <Text style={[typography.h1, { color: colors.eelDarkBlue, marginVertical: spacing.sm }]}>$2.99</Text>
            <Text style={[typography.caption, { color: colors.eelDarkBlue }]}>/month</Text>
          </View>

          <View style={[styles.priceCard, { backgroundColor: colors.gold, borderColor: colors.eelDarkBlue, borderBottomWidth: 3 }]}>
            <Text style={[typography.bodyBold, { color: themeColors.paper }]}>ANNUAL</Text>
            <Text style={[typography.h1, { color: themeColors.paper, marginVertical: spacing.sm }]}>$19.99</Text>
            <Text style={[typography.caption, { color: themeColors.paper }]}>/year (Save 44%)</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.subscribeButton, { backgroundColor: colors.ectoGreen, borderBottomWidth: 3, borderBottomColor: colors.eelDarkBlue, borderRadius: radius.md }]}
          activeOpacity={0.8}
          onPress={handleSubscribe}
        >
          <Text style={[typography.label, { color: colors.eelDarkBlue, textAlign: 'center' }]}>Subscribe Now</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.restoreButton]}
          activeOpacity={0.7}
          onPress={handleRestore}
        >
          <Text style={[typography.bodyMedium, { color: themeColors.inkMuted, textAlign: 'center' }]}>Restore Purchase</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.closeButton}
          activeOpacity={0.7}
          onPress={() => navigation.goBack()}
        >
          <Text style={[typography.bodyMedium, { color: colors.ectoGreen, textAlign: 'center' }]}>Maybe Later</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: layout.screenPaddingH,
    paddingTop: layout.headerPaddingTop + spacing.xl,
    paddingBottom: layout.safeAreaBottom + spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  icon: {
    fontSize: 56,
  },
  features: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.sm,
    borderWidth: 2,
    gap: spacing.md,
  },
  featureIcon: {
    fontSize: 28,
  },
  featureText: {
    flex: 1,
  },
  pricing: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  priceCard: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
  },
  subscribeButton: {
    paddingVertical: spacing.lg,
    marginBottom: spacing.md,
  },
  restoreButton: {
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  closeButton: {
    paddingVertical: spacing.md,
  },
});
