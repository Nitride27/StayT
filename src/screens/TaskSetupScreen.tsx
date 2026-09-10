import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
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
  const [searchQuery, setSearchQuery] = useState('');

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
      await store.saveTask({ ...existingTask, name: taskName.trim(), packageName: packageName.trim() });
    } else {
      await store.saveTask({
        id: `task-${Date.now()}`,
        name: taskName.trim(),
        packageName: packageName.trim(),
        appName: packageName.trim(),
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
    <View style={[styles.container, { backgroundColor: isDark ? colors.midnight : colors.paper }]}>
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
            style={[styles.input, { color: isDark ? '#f5f5f5' : colors.midnight, backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}
            placeholder="e.g., Morning Focus"
            placeholderTextColor={colors.inkMuted}
            value={taskName}
            onChangeText={setTaskName}
          />

          <Text style={[typography.bodyMedium, { color: isDark ? '#f5f5f5' : colors.midnight, marginTop: spacing.xl, marginBottom: spacing.md }]}>
            App Package Name
          </Text>
          <TextInput
            style={[styles.input, { color: isDark ? '#f5f5f5' : colors.midnight, backgroundColor: isDark ? '#1a2332' : colors.paperCard, borderColor: isDark ? '#2a3a4a' : colors.paperBorder }]}
            placeholder="e.g., com.instagram.android"
            placeholderTextColor={colors.inkMuted}
            value={packageName}
            onChangeText={setPackageName}
          />

          <Text style={[typography.caption, { color: isDark ? colors.inkMuted : colors.inkSecondary, marginTop: spacing.sm }]}>
            Enter the exact package name of the app you want to block
          </Text>
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
