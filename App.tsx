import React, { useState, useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import TaskPickerScreen from './src/screens/TaskPickerScreen';
import TaskSetupScreen from './src/screens/TaskSetupScreen';
import ActiveSessionScreen from './src/screens/ActiveSessionScreen';
import BlockedInterstitialScreen from './src/screens/BlockedInterstitialScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import PermissionSetupScreen from './src/screens/PermissionSetupScreen';
import { store } from './src/storage/store';
import { Task, Session } from './src/types';

export type RootStackParamList = {
  TaskPicker: undefined;
  TaskSetup: { task?: Task };
  ActiveSession: { task: Task; session: Session };
  BlockedInterstitial: { packageName: string; taskId: string };
  History: undefined;
  PermissionSetup: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { isDark } = useTheme();

  return (
    <>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
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
          <Stack.Screen
            name="History"
            component={HistoryScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="PermissionSetup"
            component={PermissionSetupScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppNavigator />
    </ThemeProvider>
  );
}
