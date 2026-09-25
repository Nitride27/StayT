// Quiet in-session native ad: one card in the session's own card language
// (2px ink border, paper card, calm type). Free tier only; renders nothing
// until an ad is actually loaded, so no empty frame ever jumps in.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
  NativeMediaAspectRatio,
} from 'react-native-google-mobile-ads';
import { useTheme } from '../theme/ThemeContext';
import { typography, spacing, radius, colors, darkColors } from '../theme/tokens';
import { AD_UNITS, showAds } from './ads';

export default function SessionAd() {
  const { isDark } = useTheme();
  const [ad, setAd] = useState<NativeAd | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: NativeAd | null = null;
    (async () => {
      if (!(await showAds())) return;
      loaded = await NativeAd.createForAdRequest(AD_UNITS.native, {
        aspectRatio: NativeMediaAspectRatio.SQUARE,
        startVideoMuted: true,
      }).catch(() => null);
      if (live) setAd(loaded);
      else loaded?.destroy();
    })();
    return () => {
      live = false;
      loaded?.destroy();
    };
  }, []);

  if (!ad) return null;

  const ink = isDark ? darkColors.ink : colors.ink;
  const muted = isDark ? darkColors.inkMuted : colors.inkMuted;
  const cardBg = isDark ? darkColors.paperCard : colors.paperCard;
  const border = isDark ? darkColors.paperBorder : colors.paperBorder;

  return (
    // Border lives on a wrapper: NativeAdView drops border styles.
    <View style={[styles.frame, { backgroundColor: cardBg, borderColor: border }]}>
    <NativeAdView nativeAd={ad} style={styles.card}>
      <NativeMediaView style={styles.media} resizeMode="cover" />
      <View style={styles.info}>
        <View style={[styles.badge, { borderColor: muted }]}>
          <Text style={[typography.label, { color: muted }]}>AD</Text>
        </View>
        <NativeAsset assetType={NativeAssetType.HEADLINE}>
          <Text numberOfLines={1} style={[typography.bodyStrong, { color: ink }]}>{ad.headline}</Text>
        </NativeAsset>
        {!!ad.body && (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text numberOfLines={1} style={[typography.caption, { color: muted }]}>{ad.body}</Text>
          </NativeAsset>
        )}
        {!!ad.callToAction && (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <Text style={[typography.label, styles.cta, { color: isDark ? colors.ectoGreen : colors.ectoGreenDark }]}>
              {ad.callToAction.toUpperCase()}
            </Text>
          </NativeAsset>
        )}
      </View>
    </NativeAdView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    borderWidth: 2,
    borderRadius: radius.md,
    marginTop: spacing.xl,
    overflow: 'hidden',
  },
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  // 120dp: the SDK's minimum for video playback in a MediaView.
  media: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  info: {
    flex: 1,
    gap: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
  },
  cta: {
    paddingTop: spacing.sm,
  },
});
