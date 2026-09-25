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

// Legal promises: change a line here only when the app's behavior changed,
// and bump the "Last updated" date below with it.
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
    title: 'Pro features',
    body: 'StayT has no purchases. Every Pro feature is included; turning one on plays a short rewarded ad first. Nothing about which features you use leaves your device.',
  },
  {
    title: 'Ads',
    body: 'StayT shows ads from Google AdMob: a quiet card during sessions, an occasional full-screen ad when a session ends, a short ad before every override or break, and a rewarded ad each time you turn on a Pro feature. Ads never switch off. To serve, measure and limit ads, AdMob may collect your advertising ID, IP address and basic device and interaction data, under Google\'s privacy policy (policies.google.com/privacy). In the EEA, UK and Switzerland you are asked for consent first and can change it in Settings > Ad privacy choices. You can reset or delete your advertising ID in Android Settings > Privacy > Ads.',
  },
  {
    title: 'Data sharing',
    body: 'StayT itself sends nothing off your phone. The only third party is Google AdMob, which receives the data described above. Your tasks, sessions, blocked apps and history are never shared with anyone, ad partners included.',
  },
  {
    title: 'Retention and deletion',
    body: 'Your data lives on your device until you clear it. Clear history in Settings removes sessions and attempts, and uninstalling wipes everything.',
  },
  {
    title: 'Children',
    body: 'StayT is not directed at children under 13 and is not part of Google Play\'s Families program. Its ads are not restricted to child-safe, non-personalized ads, and it relies on an Accessibility Service, so it does not meet the rules for children\'s apps. If a child has been using StayT, uninstalling it deletes all of its data.',
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
            StayT v{appVersion} · Last updated: 2026-09-25
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
