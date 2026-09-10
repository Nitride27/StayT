import React, { useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, TextInput, Platform } from 'react-native';
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
import { typography, spacing, radius, layout, colors } from '../theme/tokens';
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
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');

  useEffect(() => {
    AppBlocker.getInstalledApps().then(setInstalledApps);
  }, []);

  const filteredApps = installedApps.filter(
    (a) =>
      a.appName.toLowerCase().includes(appSearchQuery.toLowerCase()) ||
      a.packageName.toLowerCase().includes(appSearchQuery.toLowerCase()),
  );

  const handlePickApp = (app: InstalledApp) => {
    setPackageName(app.packageName);
    setAppName(app.appName);
    setShowAppPicker(false);
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
    if (!taskName.trim() || !packageName.trim()) return;

    if (existingTask) {
      await store.saveTask({ ...existingTask, name: taskName.trim(), packageName: packageName.trim(), appName: appName.trim() || packageName.trim() });
    } else {
      await store.saveTask({
        id: `task-${Date.now()}`,
        name: taskName.trim(),
        packageName: packageName.trim(),
        appName: appName.trim() || packageName.trim(),
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

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#000000' : colors.paper }]}>
      <Animated.View style={[styles.header, headerAnimStyle]}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={[typography.bodyMedium, { color: colors.macawBlue }]}>← Back</Text>
          </TouchableOpacity>
          <Text style={[typography.h1, { color: isDark ? '#f5f5f5' : colors.midnight }]}>
            {existingTask ? 'Edit Task' : 'New Task'}
          </Text>
          <View style={{ width: 50 }} />
        </View>
      </Animated.View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Animated.View style={[styles.form, formAnimStyle]}>
          <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight, marginBottom: spacing.md }]}>
            Task Name
          </Text>
          <TextInput
            style={[styles.input, { color: isDark ? '#f5f5f5' : colors.midnight, backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}
            placeholder="e.g., Morning Focus"
            placeholderTextColor={colors.inkMuted}
            value={taskName}
            onChangeText={setTaskName}
          />

          <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight, marginTop: spacing.xl, marginBottom: spacing.md }]}>
            App to Block
          </Text>

          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowAppPicker(!showAppPicker)}
            style={[styles.pickerToggle, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}
          >
            <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]}>
              {appName || 'Choose from installed apps'}
            </Text>
            <Text style={[typography.caption, { color: colors.ectoGreen }]}>{showAppPicker ? '▲' : '▼'}</Text>
          </TouchableOpacity>

          {showAppPicker && (
            <View style={[styles.pickerDropdown, { backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}>
              <TextInput
                style={[styles.input, { marginBottom: spacing.sm, backgroundColor: isDark ? '#0a0a0a' : colors.paper, borderColor: isDark ? '#222222' : colors.paperBorder }]}
                placeholder="Search apps..."
                placeholderTextColor={colors.inkMuted}
                value={appSearchQuery}
                onChangeText={setAppSearchQuery}
              />
              <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                {filteredApps.length === 0 ? (
                  <View style={styles.noAppsFound}>
                    <Image source={mascotSource('thinking', isDark)} style={styles.noAppsImage} resizeMode="contain" />
                    <Text style={[typography.caption, { color: colors.inkMuted, paddingVertical: spacing.md, textAlign: 'center' }]}>
                      No apps found
                    </Text>
                  </View>
                ) : (
                  filteredApps.map((app) => (
                    <TouchableOpacity
                      key={app.packageName}
                      activeOpacity={0.7}
                      onPress={() => handlePickApp(app)}
                      style={[styles.pickerItem, { borderBottomColor: isDark ? '#1a1a1a' : colors.paperBorder }]}
                    >
                      <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight }]} numberOfLines={1}>
                        {app.appName}
                      </Text>
                      <Text style={[typography.caption, { color: colors.inkMuted }]} numberOfLines={1}>
                        {app.packageName}
                      </Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>
          )}

          <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight, marginTop: spacing.md, marginBottom: spacing.md }]}>
            Package Name (manual override)
          </Text>
          <TextInput
            style={[styles.input, { color: isDark ? '#f5f5f5' : colors.midnight, backgroundColor: isDark ? '#111111' : colors.paperCard, borderColor: isDark ? '#222222' : colors.paperBorder }]}
            placeholder="e.g., com.instagram.android"
            placeholderTextColor={colors.inkMuted}
            value={packageName}
            onChangeText={(text) => { setPackageName(text); setAppName(''); }}
          />
        </Animated.View>
      </ScrollView>

      <Animated.View style={[styles.bottomSection, buttonAnimStyle]}>
        <AnimatedTouchable
          style={[styles.primaryButton, { opacity: taskName.trim() && packageName.trim() ? 1 : 0.5 }]}
          activeOpacity={0.85}
          onPress={handleSave}
          disabled={!taskName.trim() || !packageName.trim()}
          onPressIn={taskName.trim() && packageName.trim() ? handlePressIn : undefined}
          onPressOut={taskName.trim() && packageName.trim() ? handlePressOut : undefined}
        >
          <Text style={styles.primaryButtonText}>{existingTask ? 'Save Changes' : 'Create Task'}</Text>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  form: {},
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.lg,
    fontSize: typography.body.fontSize,
  },
  pickerToggle: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerDropdown: {
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  pickerItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    ...typography.label,
    color: colors.midnight,
    textAlign: 'center',
  },
});
