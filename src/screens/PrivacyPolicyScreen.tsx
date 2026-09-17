import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { ChevronLeftIcon } from '../components/icons';
import appConfig from '../../app.json';

const appVersion: string = appConfig.expo.version;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PrivacyPolicy'>;
};

// Restyle-only: every title/body below is the existing promise text,
// verbatim. No statement weakened, none added.
const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'On-device data',
    body: 'Your tasks, sessions, blocked attempts, budgets, schedules and preferences stay in on-device AsyncStorage. They never leave your phone.',
  },
  {
    title: 'Accessibility Service',
    body: 'The Accessibility Service sees the foreground app package and web domains only to decide what to block. It does not collect keystrokes or screen content, and nothing it sees is transmitted anywhere.',
  },
  {
    title: 'Notifications',
    body: 'Reminders are scheduled locally on your device. No notification content is sent to any server.',
  },
  {
    title: 'Purchases and Pro',
    body: 'Payments are handled by Google Play Billing. StayT stores only an isSubscribed flag for restore and never sees or stores card data.',
  },
  {
    title: 'Future ads',
    body: 'StayT shows no ads today. If ads ship later, ad SDKs may collect device identifiers and coarse signals for ads, and this policy will be updated with consent re-asked before launch.',
  },
  {
    title: 'Data sharing',
    body: 'StayT shares no data with third parties today.',
  },
  {
    title: 'Retention and deletion',
    body: 'Your data lives on your device until you clear it. Clear history in Settings removes sessions and attempts, and uninstalling wipes everything.',
  },
  {
    title: 'Children',
    body: 'StayT is not for children under 13.',
  },
  {
    title: 'Contact',
    body: 'To ask about your data, reach us through the support options in the app.',
  },
];

function PolicySection({
  title,
  body,
  ink,
  muted,
  cardBg,
  cardBorder,
  index,
}: {
  title: string;
  body: string;
  ink: string;
  muted: string;
  cardBg: string;
  cardBorder: string;
  index: number;
}) {
  return (
    <Animated.View
      entering={FadeInUp.duration(280).delay(200 + index * 60)}
      style={[styles.rowBox, { backgroundColor: cardBg, borderColor: cardBorder }]}
    >
      <Text accessibilityRole="header" style={[typography.h3, { color: ink }]}>
        {title}
      </Text>
      <Text style={[typography.body, { color: muted }]}>{body}</Text>
    </Animated.View>
  );
}

export default function PrivacyPolicyScreen({ navigation }: Props) {
  const { isDark, colors: theme } = useTheme();

  const ink = isDark ? darkColors.ink : colors.midnight;
  const muted = isDark ? darkColors.inkSecondary : colors.inkSecondary;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const cardBorder = isDark ? darkColors.ink : colors.ink;

  return (
    <View style={[styles.container, { backgroundColor: theme.paper }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View entering={FadeInUp.duration(280).delay(100)} style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
              style={styles.backIcon}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ChevronLeftIcon size={24} color={ink} />
            </TouchableOpacity>
            <View style={{ width: 50 }} />
          </View>
          <Text style={[typography.display, { color: ink, marginTop: spacing.md, textAlign: 'center' }]}>
            PRIVACY POLICY
          </Text>
          <Text style={[typography.caption, { color: muted, marginTop: spacing.sm, textAlign: 'center' }]}>
            StayT v{appVersion} · Last updated: 2026-09-16
          </Text>
          <View style={[styles.divider, { backgroundColor: theme.paperBorder }]} />
        </Animated.View>

        {SECTIONS.map((section, index) => (
          <PolicySection
            key={section.title}
            title={section.title}
            body={section.body}
            ink={ink}
            muted={muted}
            cardBg={cardBg}
            cardBorder={cardBorder}
            index={index}
          />
        ))}
      </ScrollView>
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
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  backIcon: {
    width: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  divider: {
    height: 2,
    borderRadius: 1,
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  rowBox: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    marginBottom: spacing.md,
  },
});
