import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task } from '../types';
import AppBlocker from '../native/AppBlocker';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskSetup'>;
};

export default function TaskSetupScreen({ navigation }: Props) {
  const [taskName, setTaskName] = useState('');
  const [selectedApp, setSelectedApp] = useState<{ packageName: string; appName: string } | null>(null);
  const [installedApps, setInstalledApps] = useState<{ packageName: string; appName: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadInstalledApps();
  }, []);

  const loadInstalledApps = async () => {
    const apps = await AppBlocker.getInstalledApps();
    // Filter out system apps and StayT itself
    const filteredApps = apps.filter(app => 
      !app.packageName.startsWith('com.android') &&
      !app.packageName.startsWith('com.google.android') &&
      app.packageName !== 'com.stayt.blocker'
    );
    setInstalledApps(filteredApps);
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
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Task</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Task Name</Text>
        <TextInput
          style={styles.input}
          value={taskName}
          onChangeText={setTaskName}
          placeholder="e.g., Focus Work"
          placeholderTextColor="#999"
        />

        <Text style={styles.label}>App to Block</Text>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search apps..."
          placeholderTextColor="#999"
        />

        <ScrollView style={styles.appList}>
          {filteredApps.map((app) => (
            <TouchableOpacity
              key={app.packageName}
              style={[
                styles.appItem,
                selectedApp?.packageName === app.packageName && styles.appItemSelected
              ]}
              onPress={() => setSelectedApp(app)}
            >
              <Text style={styles.appName}>{app.appName}</Text>
              <Text style={styles.packageName}>{app.packageName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
          <Text style={styles.saveButtonText}>Save Task</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  backButton: {
    fontSize: 16,
    color: '#58cc02',
    fontWeight: '600',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000437',
  },
  form: {
    flex: 1,
    paddingHorizontal: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  searchInput: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  appList: {
    flex: 1,
    marginTop: 12,
  },
  appItem: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  appItemSelected: {
    borderColor: '#58cc02',
    backgroundColor: '#f0fff0',
  },
  appName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000437',
  },
  packageName: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#58cc02',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderBottomColor: '#042c60',
    marginBottom: 24,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000437',
    textAlign: 'center',
  },
});
