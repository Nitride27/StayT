import React, { useState, useEffect } from 'react';
import { View, Text, Image, Alert, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
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
import { Task } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout, colors, darkColors } from '../theme/tokens';
import { mascotSource } from '../theme/mascot';
import AppBlocker from '../native/AppBlocker';

type InstalledApp = { packageName: string; appName: string };

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskSetup'>;
  route: { params: { task?: Task } };
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function TaskSetupScreen({ navigation, route }: Props) {
  const { isDark } = useTheme();
  const existingTask = route.params?.task;
  const [taskName, setTaskName] = useState(existingTask?.name || '');
  const [packageName, setPackageName] = useState(existingTask?.packageName || '');
  const [appName, setAppName] = useState(existingTask?.appName || '');
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedApps, setSelectedApps] = useState<InstalledApp[]>(() => {
    if (!existingTask) return [];
    if (existingTask.blockedPackages && existingTask.blockedPackages.length > 0) {
      return existingTask.blockedPackages.map(pkg => ({
        packageName: pkg,
        appName: pkg === existingTask.packageName ? existingTask.appName : pkg,
      }));
    }
    return existingTask.packageName
      ? [{ packageName: existingTask.packageName, appName: existingTask.appName }]
      : [];
  });

  useEffect(() => {
    AppBlocker.getInstalledApps().then(setInstalledApps).catch(() => setInstalledApps([]));
    store.getPreferences().then(p => setIsSubscribed(p.isSubscribed === true)).catch(() => {});
  }, []);

  const filteredApps = installedApps.filter(
    (a) =>
      a.appName.toLowerCase().includes(appSearchQuery.toLowerCase()) ||
      a.packageName.toLowerCase().includes(appSearchQuery.toLowerCase()),
  );

  const handlePickApp = (app: InstalledApp) => {
    const already = selectedApps.some(a => a.packageName === app.packageName);
    if (already) {
      const next = selectedApps.filter(a => a.packageName !== app.packageName);
      setSelectedApps(next);
      setPackageName(next[0]?.packageName ?? '');
      setAppName(next[0]?.appName ?? '');
      return;
    }
    // Free users block a single app; multi-block is Pro.
    if (!isSubscribed && selectedApps.length >= 1) {
      Alert.alert('Pro feature', 'Blocking multiple apps at once needs Pro.', [
        { text: 'View Pro', onPress: () => navigation.navigate('Paywall') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    const next = [...selectedApps, app];
    setSelectedApps(next);
    setPackageName(next[0].packageName);
    setAppName(next[0].appName);
    setAppSearchQuery('');
  };

  // Entry animations
  const headerOpacity = useSharedValue(0);
  const headerTranslateY = useSharedValue(20);
  const formOpacity = useSharedValue(0);
  const formTranslateY = useSharedValue(20);
  const buttonOpacity = useSharedValue(0);
  const buttonScale = useSharedValue(1);

  useEffect(() => {
    headerOpacity.value = withDelay(100, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    headerTranslateY.value = withDelay(100, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    formOpacity.value = withDelay(250, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    formTranslateY.value = withDelay(250, withTiming(0, { duration: 400, easing: Easing.out(Easing.cubic) }));

    buttonOpacity.value = withDelay(400, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
  }, []);

  const handleSave = async () => {
    if (!taskName.trim()) return;
    // Manual override wins; otherwise use the picked app(s).
    const pkgs = selectedApps.length > 0
      ? selectedApps.map(a => a.packageName)
      : (packageName.trim() ? [packageName.trim()] : []);
    if (pkgs.length === 0) return;
    const firstApp = selectedApps[0]?.appName || appName.trim() || pkgs[0];

    if (existingTask) {
      await store.saveTask({ ...existingTask, name: taskName.trim(), packageName: pkgs[0], appName: firstApp, blockedPackages: pkgs });
    } else {
      await store.saveTask({
        id: `task-${Date.now()}`,
        name: taskName.trim(),
        packageName: pkgs[0],
        appName: firstApp,
        blockedPackages: pkgs,
        createdAt: Date.now(),
        lastUsed: 0,
        useCount: 0,
        isActive: true,
        streak: 0,
      });
    }
    navigation.goBack();
  };

  const headerAnimStyle = useAnimatedStyle(() => ({
    opacity: headerOpacity.value,
    transform: [{ translateY: headerTranslateY.value }],
  }));

  const formAnimStyle = useAnimatedStyle(() => ({
    opacity: formOpacity.value,
    transform: [{ translateY: formTranslateY.value }],
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

  const bg = isDark ? darkColors.paper : colors.paper;
  const ink = isDark ? darkColors.ink : colors.ink;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const border = isDark ? darkColors.ink : colors.ink;
  const hairline = isDark ? darkColors.paperBorder : colors.paperBorder;
  const canSave = taskName.trim() && (selectedApps.length > 0 || packageName.trim());

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backRow}>
            <Text style={[typography.h2, { color: colors.macawBlue }]}>{'‹'}</Text>
            <Text style={[typography.bodyMedium, { color: colors.macawBlue }]}>Back</Text>
          </TouchableOpacity>
          <Text style={[typography.h1, { color: ink }]}>
            {existingTask ? 'Edit Task' : 'New Task'}
          </Text>
          <View style={{ width: 60 }} />
        </View>
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.form, formAnimStyle]}>
          <Text style={[typography.label, { color: ink, marginBottom: spacing.sm }]}>
            TASK NAME
          </Text>
          <TextInput
            style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border }]}
            placeholder="e.g., Morning Focus"
            placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
            value={taskName}
            onChangeText={setTaskName}
          />

          <Text style={[typography.label, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            INSTALLED APPS
          </Text>
          <TextInput
            style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border, marginBottom: spacing.sm }]}
            placeholder="Search apps..."
            placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
            value={appSearchQuery}
            onChangeText={setAppSearchQuery}
          />
          {filteredApps.length === 0 ? (
            <View style={styles.noAppsFound}>
              <Image source={mascotSource('thinking', isDark)} style={styles.noAppsImage} resizeMode="contain" />
              <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkMuted, paddingVertical: spacing.md, textAlign: 'center' }]}>
                No apps found
              </Text>
            </View>
          ) : (
            <View style={[styles.appList, { backgroundColor: cardBg, borderColor: border }]}>
              {filteredApps.map((app) => {
                const checked = selectedApps.some(a => a.packageName === app.packageName);
                return (
                  <TouchableOpacity
                    key={app.packageName}
                    activeOpacity={0.7}
                    onPress={() => handlePickApp(app)}
                    style={[styles.appRow, { borderBottomColor: hairline }]}
                  >
                    <View style={[styles.checkbox, { borderColor: border }, checked && styles.checkboxChecked]}>
                      {checked && (
                        <Text style={[typography.label, { color: colors.midnight }]}>✓</Text>
                      )}
                    </View>
                    <View style={styles.appInfo}>
                      <Text style={[typography.bodyMedium, { color: ink }]} numberOfLines={1}>
                        {app.appName}
                      </Text>
                      <Text style={[typography.caption, { color: isDark ? darkColors.inkMuted : colors.inkMuted }]} numberOfLines={1}>
                        {app.packageName}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={[typography.label, { color: ink, marginTop: spacing.xl, marginBottom: spacing.sm }]}>
            PACKAGE NAME (MANUAL OVERRIDE)
          </Text>
          <TextInput
            style={[styles.input, { color: ink, backgroundColor: cardBg, borderColor: border }]}
            placeholder="e.g., com.instagram.android"
            placeholderTextColor={isDark ? darkColors.inkMuted : colors.inkMuted}
            value={packageName}
            onChangeText={(text) => { setPackageName(text); setAppName(''); setSelectedApps([]); }}
          />
        </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: canSave ? 1 : 0.5 }]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!canSave}
          onPressIn={canSave ? handlePressIn : undefined}
          onPressOut={canSave ? handlePressOut : undefined}
        >
          <Text style={styles.primaryButtonText}>{existingTask ? 'SAVE TASK' : 'CREATE TASK'}</Text>
        </AnimatedTouchable>
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
    marginBottom: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    width: 60,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  form: {},
  input: {
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: typography.body.fontSize,
  },
  appList: {
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.ectoGreen,
    borderColor: colors.ectoGreen,
  },
  appInfo: {
    flex: 1,
  },
  noAppsFound: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  noAppsImage: {
    width: 64,
    height: 64,
  },
  bottomSection: {
    paddingTop: spacing.lg,
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
    ...typography.button,
    color: colors.midnight,
    textAlign: 'center',
  },
});
