import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Welcome'>;
};

export default function WelcomeScreen({ navigation }: Props) {
  const { isDark } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: isDark ? colors.midnight : colors.paper }]}>
      <View style={styles.topSection}>
        <View style={styles.heroArea}>
          <Text style={styles.heroEmoji}>🛡️</Text>
          <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight, textAlign: 'center', marginTop: spacing.xl }]}>
            Stay focused.
          </Text>
          <Text style={[typography.h1, { color: colors.ectoGreen, textAlign: 'center', marginTop: spacing.xs }]}>
            Stay on track.
          </Text>
        </View>

        <View style={styles.features}>
          <FeatureRow
            icon="🎯"
            title="Set your focus"
            desc="Pick one app to block during deep work"
            dark={isDark}
          />
          <FeatureRow
            icon="🔥"
            title="Build your streak"
            desc="Each day you resist builds your streak"
            dark={isDark}
          />
          <FeatureRow
            icon="⚡"
            title="Stay in the zone"
            desc="One-tap redirect keeps you on task"
            dark={isDark}
          />
        </View>
      </View>

      <View style={styles.bottomSection}>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('PermissionSetup')}
        >
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </TouchableOpacity>

        <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkMuted, textAlign: 'center', marginTop: spacing.md }]}>
          Takes 30 seconds to set up
        </Text>
      </View>
    </View>
  );
}

function FeatureRow({ icon, title, desc, dark }: { icon: string; title: string; desc: string; dark: boolean }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <View style={styles.featureText}>
        <Text style={[typography.bodyMedium, { color: dark ? '#f5f5f5' : colors.midnight }]}>{title}</Text>
        <Text style={[typography.caption, { color: dark ? colors.inkMuted : colors.inkSecondary, marginTop: 2 }]}>{desc}</Text>
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
  },
  topSection: {
    flex: 1,
    justifyContent: 'center',
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: spacing.xxxl,
  },
  heroEmoji: {
    fontSize: 64,
  },
  features: {
    gap: spacing.xl,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  featureIcon: {
    fontSize: 28,
    width: 44,
    height: 44,
    textAlign: 'center',
    lineHeight: 44,
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
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.midnight,
    textAlign: 'center',
  },
});
