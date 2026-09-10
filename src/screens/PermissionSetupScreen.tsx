import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import * as Device from 'expo-device';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../App';
import AppBlocker from '../native/AppBlocker';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, layout } from '../theme/tokens';
import { store } from '../storage/store';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'PermissionSetup'>;
};

type PermissionStatus = {
  accessibility: boolean;
};

export default function PermissionSetupScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [permissions, setPermissions] = useState<PermissionStatus>({
    accessibility: false,
  });
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkPermissions();
    const interval = setInterval(checkPermissions, 1500);
    return () => clearInterval(interval);
  }, []);

  const checkPermissions = async () => {
    try {
      const accessGranted = await AppBlocker.isAccessibilityServiceEnabled();
      setPermissions({ accessibility: accessGranted });
    } catch {}
    setChecking(false);
  };

  const openAccessibilitySettings = async () => {
    if (Platform.OS === 'android') {
      try {
        await Linking.openSettings();
      } catch {
        await Linking.openURL('package:com.nitridee.staytapp');
      }
    }
  };

  const allGranted = permissions.accessibility;

  const manufacturer = (Device.manufacturer || '').toLowerCase();
  const isXiaomi = Platform.OS === 'android' && ['xiaomi', 'poco', 'redmi'].includes(manufacturer);
  const isSamsung = Platform.OS === 'android' && manufacturer === 'samsung';
  const isOemDevice = isXiaomi || isSamsung || 
    ['oppo', 'realme', 'vivo', 'oneplus'].includes(manufacturer);

  const handleContinue = async () => {
    const prefs = await store.getPreferences();
    if (!prefs.hasOnboarded) {
      await store.savePreferences({ ...prefs, hasOnboarded: true });
    }
    navigation.navigate('TaskPicker');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.paper }]}>
      <View style={[styles.header, { paddingTop: layout.headerPaddingTop, paddingHorizontal: layout.screenPaddingH, paddingBottom: spacing.xl }]}>
        <Text style={[typography.h1, { color: colors.ink }]}>Permissions</Text>
        <Text style={[typography.body, { color: colors.inkMuted, marginTop: spacing.sm }]}>
          StayT needs these permissions to block distracting apps
        </Text>
      </View>

      <View style={[styles.content, { paddingHorizontal: layout.screenPaddingH }]}>
        {/* Accessibility Service */}
        <View style={[styles.permissionCard, { backgroundColor: colors.paperCard, borderRadius: radius.md }]}>
          <View style={styles.permissionRow}>
            <View style={styles.permissionLeft}>
              <Text style={[typography.bodyMedium, { color: colors.ink }]}>Accessibility Service</Text>
              <Text style={[typography.caption, { color: colors.inkMuted, marginTop: spacing.xs }]}>
                Detects when blocked apps are opened
              </Text>
            </View>
            <View style={[
              styles.statusBadge,
              {
                backgroundColor: permissions.accessibility ? colors.ectoGreen : colors.paperBorder,
                borderRadius: radius.full,
              }
            ]}>
              <Text style={[typography.caption, { color: permissions.accessibility ? colors.midnight : colors.inkMuted }]}>
                {permissions.accessibility ? 'Active' : 'Needed'}
              </Text>
            </View>
          </View>

          {!permissions.accessibility && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                {
                  backgroundColor: colors.ectoGreen,
                  borderBottomWidth: 3,
                  borderBottomColor: colors.eelDarkBlue,
                  borderRadius: radius.md,
                }
              ]}
              activeOpacity={0.8}
              onPress={openAccessibilitySettings}
            >
              <Text style={[typography.label, { color: colors.midnight, textAlign: 'center' }]}>
                Enable Accessibility
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* OEM-specific accessibility note */}
        {isOemDevice && (
          <View style={[styles.noteCard, { backgroundColor: colors.permissionBanner, borderRadius: radius.md }]}>
            <Text style={[typography.bodyMedium, { color: colors.permissionBannerText }]}>
              {isSamsung ? 'Samsung Note' : 'HyperOS/MIUI Note'}
            </Text>
            <Text style={[typography.body, { color: colors.permissionBannerText, marginTop: spacing.sm }]}>
              {isSamsung
                ? 'Go to Settings → Accessibility → Installed apps → StayT → Enable'
                : 'Go to Additional settings → Accessibility → Downloaded apps → StayT → Enable'}
            </Text>
            <Text style={[typography.caption, { color: colors.permissionBannerText, marginTop: spacing.sm }]}>
              {isSamsung
                ? 'If not listed: Settings → Apps → StayT → Permissions → Allow all permissions'
                : 'If blocked: long-press StayT app icon → App info → ⋮ → Allow restricted settings'}
            </Text>
          </View>
        )}

        {/* OEM Battery Warning */}
        <View style={[styles.noteCard, { backgroundColor: colors.permissionBanner, borderRadius: radius.md }]}>
          <Text style={[typography.bodyMedium, { color: colors.permissionBannerText }]}>
            Battery Optimization
          </Text>
          <Text style={[typography.body, { color: colors.permissionBannerText, marginTop: spacing.sm }]}>
            To keep StayT running in the background, disable battery optimization:
          </Text>
          <Text style={[typography.caption, { color: colors.permissionBannerText, marginTop: spacing.sm }]}>
            Settings → Apps → StayT → Battery → Unrestricted
          </Text>
          {isOemDevice && (
            <Text style={[typography.caption, { color: colors.permissionBannerText, marginTop: spacing.sm }]}>
              Also check: Settings → Battery → Background restrictions → Ensure StayT is not restricted
            </Text>
          )}
        </View>

        {/* Info */}
        <View style={[styles.infoCard, { backgroundColor: colors.paperCard, borderRadius: radius.md }]}>
          <Text style={[typography.bodyMedium, { color: colors.ink }]}>How it works</Text>
          <Text style={[typography.body, { color: colors.inkSecondary, marginTop: spacing.sm }]}>
            StayT uses the accessibility service to detect when you try to open a blocked app. It then shows a quick redirect screen to help you stay focused. No data is collected or transmitted.
          </Text>
        </View>
      </View>

      {/* Continue Button */}
      <View style={[styles.footer, { paddingHorizontal: layout.screenPaddingH, paddingBottom: layout.safeAreaBottom }]}>
        <TouchableOpacity
          style={[
            styles.continueButton,
            {
              backgroundColor: allGranted ? colors.ectoGreen : colors.paperBorder,
              borderBottomWidth: allGranted ? 3 : 0,
              borderBottomColor: allGranted ? colors.eelDarkBlue : 'transparent',
              borderRadius: radius.md,
            }
          ]}
          activeOpacity={0.8}
          onPress={handleContinue}
          disabled={!allGranted && !checking}
        >
          <Text style={[
            typography.label,
            {
              color: allGranted ? colors.midnight : colors.inkMuted,
              textAlign: 'center',
            }
          ]}>
            {checking ? 'Checking...' : allGranted ? 'Continue' : 'Enable to continue'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {},
  content: {
    flex: 1,
    gap: spacing.lg,
  },
  permissionCard: {
    padding: spacing.lg,
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  permissionLeft: {
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginLeft: spacing.md,
  },
  actionButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  noteCard: {
    padding: spacing.lg,
  },
  infoCard: {
    padding: spacing.lg,
  },
  footer: {},
  continueButton: {
    paddingVertical: spacing.lg,
  },
});
