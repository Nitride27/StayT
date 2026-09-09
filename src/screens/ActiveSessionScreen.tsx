import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { store } from '../storage/store';
import { Task, Session } from '../types';
import AppBlocker from '../native/AppBlocker';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'ActiveSession'>;
  route: {
    params: {
      task: Task;
      session: Session;
    };
  };
};

export default function ActiveSessionScreen({ navigation, route }: Props) {
  const { task, session } = route.params;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startTime = session.startedAt;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [session.startedAt]);

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndTask = async () => {
    await AppBlocker.stopBlocking();
    const updatedSession: Session = {
      ...session,
      endedAt: Date.now(),
      duration: Date.now() - session.startedAt,
      status: 'completed',
    };
    await store.saveSession(updatedSession);

    // Update task stats
    const updatedTask: Task = {
      ...task,
      lastUsed: Date.now(),
      useCount: task.useCount + 1,
      isActive: false,
    };
    await store.saveTask(updatedTask);

    navigation.navigate('TaskPicker');
  };

  const handleSwitchTask = async () => {
    await AppBlocker.stopBlocking();
    const updatedSession: Session = {
      ...session,
      endedAt: Date.now(),
      duration: Date.now() - session.startedAt,
      status: 'cancelled',
    };
    await store.saveSession(updatedSession);
    navigation.navigate('TaskPicker');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.taskName}>{task.name}</Text>
        <Text style={styles.appName}>Blocking: {task.appName}</Text>
      </View>

      <View style={styles.timerContainer}>
        <Text style={styles.timer}>{formatTime(elapsed)}</Text>
        <Text style={styles.timerLabel}>Time focused</Text>
      </View>

      <View style={styles.streakContainer}>
        <Text style={styles.streak}>🔥 {task.streak} day streak</Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.endButton} onPress={handleEndTask}>
          <Text style={styles.endButtonText}>End Task</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.switchButton} onPress={handleSwitchTask}>
          <Text style={styles.switchButtonText}>Switch Task</Text>
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
  taskName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000437',
  },
  appName: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  timerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timer: {
    fontSize: 64,
    fontWeight: '700',
    color: '#58cc02',
  },
  timerLabel: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
  },
  streakContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  streak: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000437',
  },
  buttonContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  endButton: {
    backgroundColor: '#58cc02',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderBottomColor: '#042c60',
    marginBottom: 12,
  },
  endButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000437',
    textAlign: 'center',
  },
  switchButton: {
    backgroundColor: 'white',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
  },
  switchButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000437',
    textAlign: 'center',
  },
});
