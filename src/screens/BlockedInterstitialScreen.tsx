import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'BlockedInterstitial'>;
  route: {
    params: {
      packageName: string;
      taskId: string;
    };
  };
};

export default function BlockedInterstitialScreen({ navigation, route }: Props) {
  const { packageName, taskId } = route.params;

  const handleReturnToTask = () => {
    // Return to the active task screen
    navigation.goBack();
  };

  const handleOverride = () => {
    // Allow override with confirmation
    navigation.goBack();
  };

  const handleSwitchTask = () => {
    // Switch to a different task
    navigation.navigate('TaskPicker');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🚫</Text>
        <Text style={styles.title}>App Blocked</Text>
        <Text style={styles.subtitle}>
          You're trying to access {packageName}
        </Text>
        <Text style={styles.message}>
          Stay focused on your current task
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.returnButton} onPress={handleReturnToTask}>
          <Text style={styles.returnButtonText}>Return to Task</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.overrideButton} onPress={handleOverride}>
          <Text style={styles.overrideButtonText}>Override (5 min)</Text>
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  icon: {
    fontSize: 64,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000437',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
  },
  buttonContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  returnButton: {
    backgroundColor: '#58cc02',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderBottomWidth: 4,
    borderBottomColor: '#042c60',
    marginBottom: 12,
  },
  returnButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000437',
    textAlign: 'center',
  },
  overrideButton: {
    backgroundColor: 'white',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e0e0e0',
    marginBottom: 12,
  },
  overrideButtonText: {
    fontSize: 18,
    fontWeight: '600',
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
