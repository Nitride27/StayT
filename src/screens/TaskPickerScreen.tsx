import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task } from '../types';
import AppBlocker from '../native/AppBlocker';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'TaskPicker'>;
};

export default function TaskPickerScreen({ navigation }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [accessibilityEnabled, setAccessibilityEnabled] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const loadedTasks = await store.getTasks();
    setTasks(loadedTasks);
    const enabled = await AppBlocker.isAccessibilityServiceEnabled();
    setAccessibilityEnabled(enabled);
  };

  const handleNewTask = () => {
    if (tasks.length >= 1) {
      Alert.alert(
        'Free Version',
        'Upgrade to Pro to create unlimited tasks',
        [{ text: 'OK' }]
      );
      return;
    }
    navigation.navigate('TaskSetup');
  };

  const handleTaskPress = (task: Task) => {
    if (!accessibilityEnabled) {
      Alert.alert(
        'Permission Required',
        'Please enable StayT Accessibility Service in Settings',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => AppBlocker.openAccessibilitySettings() }
        ]
      );
      return;
    }
    // Start session logic will go here
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>StayT</Text>
        <Text style={styles.subtitle}>Task-aware app blocker</Text>
      </View>

      <ScrollView style={styles.taskList}>
        {tasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No tasks yet</Text>
            <Text style={styles.emptySubtext}>Create your first task to get started</Text>
          </View>
        ) : (
          tasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.taskItem}
              onPress={() => handleTaskPress(task)}
            >
              <View style={styles.taskInfo}>
                <Text style={styles.taskName}>{task.name}</Text>
                <Text style={styles.taskApp}>{task.appName}</Text>
              </View>
              <View style={styles.taskMeta}>
                <Text style={styles.streak}>🔥 {task.streak}</Text>
                <Text style={styles.useCount}>× {task.useCount}</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      <TouchableOpacity style={styles.addButton} onPress={handleNewTask}>
        <Text style={styles.addButtonText}>+ New Task</Text>
      </TouchableOpacity>

      {!accessibilityEnabled && (
        <TouchableOpacity 
          style={styles.permissionBanner}
          onPress={() => AppBlocker.openAccessibilitySettings()}
        >
          <Text style={styles.permissionText}>
            ⚠️ Enable Accessibility Service
          </Text>
        </TouchableOpacity>
      )}
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
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: '#000437',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  taskList: {
    flex: 1,
    paddingHorizontal: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
  },
  taskItem: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  taskInfo: {
    flex: 1,
  },
  taskName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000437',
  },
  taskApp: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  taskMeta: {
    alignItems: 'flex-end',
  },
  streak: {
    fontSize: 16,
    fontWeight: '600',
    color: '#58cc02',
  },
  useCount: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  addButton: {
    backgroundColor: '#58cc02',
    marginHorizontal: 16,
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderBottomColor: '#042c60',
  },
  addButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000437',
    textAlign: 'center',
  },
  permissionBanner: {
    backgroundColor: '#fff3cd',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: 2,
    borderTopColor: '#ffc107',
  },
  permissionText: {
    fontSize: 14,
    color: '#856404',
    textAlign: 'center',
    fontWeight: '600',
  },
});
