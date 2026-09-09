import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, gamification, layout } from '../theme/tokens';

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
  const { colors } = useTheme();

  const handleReturnToTask = () => {
    navigation.goBack();
  };

  const handleOverride = () => {
    Alert.alert(
      'Override Not Available',
      'Pause-blocking override will be available in a future update.',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  };

  const handleSwitchTask = () => {
    navigation.navigate('TaskPicker');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.paper }]}>
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: colors.paperCard }]}>
          <Text style={{ fontSize: 56 }}>🚫</Text>
        </View>
        <Text style={[typography.h1, { color: colors.ink, marginTop: spacing.xl }]}>App Blocked</Text>
        <Text style={[typography.bodyMedium, { color: colors.inkSecondary, marginTop: spacing.md, textAlign: 'center' }]}>
          You're trying to access {packageName}
        </Text>
        <Text style={[typography.body, { color: colors.inkMuted, marginTop: spacing.sm, textAlign: 'center' }]}>
          Stay focused on your current task
        </Text>
      </View>

      <View style={[styles.buttonArea, { paddingHorizontal: layout.screenPaddingH, paddingBottom: layout.safeAreaBottom }]}>
        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: gamification.blockedButton.returnToTask, borderBottomWidth: 3, borderBottomColor: colors.eelDarkBlue, borderRadius: radius.md },
          ]}
          activeOpacity={0.8}
          onPress={handleReturnToTask}
        >
          <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>Return to Task</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: gamification.blockedButton.override, borderBottomWidth: 3, borderBottomColor: colors.macawBlueDark, borderRadius: radius.md },
          ]}
          activeOpacity={0.8}
          onPress={handleOverride}
        >
          <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>Override (5 min)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            { backgroundColor: colors.paperCard, borderRadius: radius.md, borderWidth: 2, borderColor: colors.paperBorder },
          ]}
          activeOpacity={0.8}
          onPress={handleSwitchTask}
        >
          <Text style={[typography.label, { color: colors.inkSecondary, textAlign: 'center' }]}>Switch Task</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonArea: {
    gap: spacing.md,
  },
  button: {
    paddingVertical: spacing.lg,
  },
});
