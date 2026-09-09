import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import TaskPickerScreen from './src/screens/TaskPickerScreen';
import TaskSetupScreen from './src/screens/TaskSetupScreen';
import ActiveSessionScreen from './src/screens/ActiveSessionScreen';
import BlockedInterstitialScreen from './src/screens/BlockedInterstitialScreen';
import { store } from './src/storage/store';
import { Task, Session } from './src/types';

export type RootStackParamList = {
  TaskPicker: undefined;
  TaskSetup: { task?: Task };
  ActiveSession: { task: Task; session: Session };
  BlockedInterstitial: { packageName: string; taskId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const loadedTasks = await store.getTasks();
    setTasks(loadedTasks);
    const session = await store.getActiveSession();
    setActiveSession(session);
  };

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="TaskPicker">
        <Stack.Screen 
          name="TaskPicker" 
          component={TaskPickerScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="TaskSetup" 
          component={TaskSetupScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="ActiveSession" 
          component={ActiveSessionScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen 
          name="BlockedInterstitial" 
          component={BlockedInterstitialScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
