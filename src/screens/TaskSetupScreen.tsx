import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task } from '../types';
import AppBlocker from '../native/AppBlocker';
import { useTheme } from '../theme/ThemeContext';
import { colors, typography, spacing, radius, buttons, shadows, layout } from '../theme/tokens';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskSetup'>;
};

export default function TaskSetupScreen({ navigation }: Props) {
  const { colors: themeColors } = useTheme();
  const [taskName, setTaskName] = useState('');
  const [selectedApp, setSelectedApp] = useState<{ packageName: string; appName: string } | null>(null);
  const [installedApps, setInstalledApps] = useState<{ packageName: string; appName: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pressedButton, setPressedButton] = useState<string | null>(null);

  useEffect(() => {
    loadInstalledApps();
  }, []);

  const loadInstalledApps = async () => {
    const apps = await AppBlocker.getInstalledApps();
    const filteredApps = apps.filter(app =>
      !app.packageName.startsWith('com.android') &&
      !app.packageName.startsWith('com.google.android') &&
      app.packageName !== 'com.nitridee.staytapp'
    );
    setInstalledApps(filteredApps);
    setLoading(false);
  };

  const filteredApps = installedApps.filter(app =>
    app.appName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    app.packageName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSave = async () => {
    if (!taskName.trim()) {
      Alert.alert('Error', 'Please enter a task name');
      return;
    }
    if (!selectedApp) {
      Alert.alert('Error', 'Please select an app to block');
      return;
    }

    const newTask: Task = {
      id: Date.now().toString(),
      name: taskName.trim(),
      packageName: selectedApp.packageName,
      appName: selectedApp.appName,
      createdAt: Date.now(),
      lastUsed: 0,
      useCount: 0,
      isActive: false,
      streak: 0,
    };

    await store.saveTask(newTask);
    navigation.goBack();
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.paper }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={[styles.backButton, { color: colors.ectoGreen }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: themeColors.ink }]}>New Task</Text>
      </View>

      <View style={styles.form}>
        <Text style={[styles.label, { color: themeColors.inkSecondary }]}>Task Name</Text>
        <TextInput
          style={[styles.input, { backgroundColor: themeColors.paperCard, borderColor: themeColors.paperBorder, color: themeColors.ink }]}
          value={taskName}
          onChangeText={setTaskName}
          placeholder="e.g., Focus Work"
          placeholderTextColor={themeColors.inkFaint}
        />

        <Text style={[styles.label, { color: themeColors.inkSecondary }]}>App to Block</Text>
        <TextInput
          style={[styles.searchInput, { backgroundColor: themeColors.paperCard, borderColor: themeColors.paperBorder, color: themeColors.ink }]}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search apps..."
          placeholderTextColor={themeColors.inkFaint}
        />

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={colors.ectoGreen} />
            <Text style={[styles.loadingText, { color: themeColors.inkMuted }]}>Loading apps...</Text>
          </View>
        ) : (
          <ScrollView style={styles.appList} contentContainerStyle={styles.appListContent}>
            {filteredApps.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={[styles.emptyText, { color: themeColors.inkMuted }]}>
                  {searchQuery ? 'No apps match your search' : 'No apps found'}
                </Text>
              </View>
            ) : (
              filteredApps.map((app) => {
                const isSelected = selectedApp?.packageName === app.packageName;
                return (
                  <TouchableOpacity
                    key={app.packageName}
                    style={[
                      styles.appItem,
                      {
                        backgroundColor: isSelected ? colors.ectoGreenLight : themeColors.paperCard,
                        borderColor: isSelected ? colors.ectoGreen : themeColors.paperBorder,
                      },
                    ]}
                    onPress={() => setSelectedApp(app)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.appInfo}>
                      <Text style={[styles.appName, { color: isSelected ? colors.eelDarkBlue : themeColors.ink }]}>{app.appName}</Text>
                      <Text style={[styles.packageName, { color: themeColors.inkMuted }]}>{app.packageName}</Text>
                    </View>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}

        <TouchableOpacity
          style={[
            styles.saveButton,
            pressedButton === 'save' ? buttons.primaryPressed : buttons.primary,
          ]}
          onPress={handleSave}
          onPressIn={() => setPressedButton('save')}
          onPressOut={() => setPressedButton(null)}
          activeOpacity={0.9}
        >
          <Text style={[styles.saveButtonText, { color: colors.eelDarkBlue }]}>Save Task</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: layout.headerPaddingTop,
    paddingHorizontal: layout.screenPaddingH,
    paddingBottom: layout.headerPaddingBottom,
  },
  backButton: {
    ...typography.bodyBold,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h1,
  },
  form: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  label: {
    ...typography.bodyMedium,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  input: {
    borderRadius: radius.md,
    padding: spacing.lg,
    ...typography.body,
    borderWidth: 2,
  },
  searchInput: {
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.body,
    borderWidth: 2,
  },
  loadingState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
  },
  loadingText: {
    ...typography.body,
    marginTop: spacing.lg,
  },
  appList: {
    flex: 1,
    marginTop: spacing.md,
  },
  appListContent: {
    paddingBottom: spacing.xl,
  },
  emptyState: {
    paddingVertical: spacing.xxxl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.body,
  },
  appItem: {
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
  },
  appInfo: {
    flex: 1,
  },
  appName: {
    ...typography.bodyBold,
  },
  packageName: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  checkmark: {
    fontSize: 20,
    color: colors.ectoGreen,
    fontWeight: '700',
  },
  saveButton: {
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radius.md,
  },
  saveButtonText: {
    ...typography.label,
    textAlign: 'center',
  },
});
