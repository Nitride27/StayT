import React, { useEffect, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import {
  witheringSheet,
  mascotMood,
  owlMoodLabel,
  witheringTargetFrame,
  WITHERING_COLS,
  WITHERING_ROWS,
  WITHERING_FRAME_MS,
  WITHERING_FRAMES,
} from '../theme/mascot';

type Props = {
  /** Today's give-in count — drives the wither target frame. */
  giveInsToday: number;
  /** Display width of one frame; height follows the sheet cell ratio. */
  width?: number;
  /** ms per frame step. Defaults to WITHERING_FRAME_MS. */
  frameMs?: number;
};

// True sheet geometry (measured from assets/whithering_away.png): 1536×1024,
// 5 cols × 4 rows → exactly 307.2 × 256 cells, transparent backdrop, no
// gutters. Neighbor art overlaps the ideal grid: battery icons + the sparkle
// burst end 1–4 src px before the right seam, green feet/leaves straddle the
// horizontal seams by up to ~5 src px; everywhere else the seam band is
// transparent or black-on-black (an invisible cut).
//
// Per-edge trim, as a fraction of one cell, sized from those measurements:
// large enough to cover overlap + bilinear fringe at any display width,
// small enough to keep every hard sprite part (feet, batteries, mound tops)
// inside the window. Right stays thin because battery outlines end ~1 src px
// before the right seam; left/top/bottom take the full guard.
const INSET_L = 0.0195; // ≈6 src px
const INSET_R = 0.0098; // ≈3 src px
const INSET_T = 0.0195; // ≈5 src px
const INSET_B = 0.0195; // ≈5 src px

// Window aspect follows the source cell (307.2:256) minus the trims, so the
// sheet maps undistorted at any width. Derived, not magic, so it can't drift
// from the insets above.
const CELL_RATIO = (256 / 307.2) * ((1 - INSET_T - INSET_B) / (1 - INSET_L - INSET_R));

/**
 * Animated loss-state owl: walks the whithering_away sprite sheet from frame
 * 0 toward the give-ins target (and back when the user recovers — retargeting
 * reassigns the same shared value, so tomorrow's fresh owl perks back up).
 * Holds the target frame when reached: no looping timers, no battery drain.
 * A failed sheet load falls back to the static mascotMood expression.
 *
 * Smoothness: a single `progress` shared value animates 0 → target on the UI
 * thread (one withTiming, linear for uniform step cadence). Two stacked sheet
 * layers derive their cell offset (transform only, never left/top) and a
 * smoothstep crossfade — each frame holds, then dissolves briskly instead of
 * lingering as a 50/50 ghost of two owls — from that value in worklets: zero
 * setState per frame, zero layout passes. `fadeDuration={0}` stops Android's
 * loader fade fighting the blend.
 * The sheet is decode-warmed behind the static fallback before `ready` flips,
 * so the animation never starts on a cold texture. Reduced-motion users snap
 * straight to the target frame.
 */
export default function WitheringOwl({ giveInsToday, width = 64, frameMs = WITHERING_FRAME_MS }: Props) {
  const { isDark } = useTheme();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduceMotion = useReducedMotion();
  // Exact float: CELL_RATIO already compensates the trims, so rounding here
  // would reintroduce distortion and drift the cut at larger widths.
  const height = width * CELL_RATIO;
  const progress = useSharedValue(0);

  // Scaled sheet geometry for the inset crop: the visible window (width ×
  // height) shows one cell minus the per-edge trims (L left, T top).
  const cellW = width / (1 - INSET_L - INSET_R);
  const cellH = height / (1 - INSET_T - INSET_B);
  const sheetW = cellW * WITHERING_COLS;
  const sheetH = cellH * WITHERING_ROWS;

  useEffect(() => {
    if (!ready || failed) return;
    const target = witheringTargetFrame(giveInsToday);
    const current = progress.value;
    if (Math.round(current) === target) {
      if (current !== target) progress.value = target;
      return;
    }
    const effFrameMs = Math.max(30, frameMs);
    const duration = reduceMotion ? 1 : Math.max(1, Math.abs(target - current) * effFrameMs);
    progress.value = withTiming(target, { duration, easing: Easing.linear });
    return () => cancelAnimation(progress);
  }, [giveInsToday, frameMs, ready, failed, reduceMotion, progress]);

  // Floor layer: shows frame ⌊progress⌋, fading out as we leave it.
  const styleA = useAnimatedStyle(() => {
    const i = Math.max(0, Math.min(WITHERING_FRAMES - 1, Math.floor(progress.value)));
    const col = i % WITHERING_COLS;
    const row = Math.floor(i / WITHERING_COLS);
    const frac = progress.value - Math.floor(progress.value);
    const e = frac * frac * (3 - 2 * frac); // smoothstep: hold, then blend
    return {
      transform: [
        { translateX: -(col + INSET_L) * cellW },
        { translateY: -(row + INSET_T) * cellH },
      ],
      opacity: 1 - e,
    };
  });

  // Ceil layer: shows frame ⌈progress⌉, fading in as we arrive. Identical
  // size/position to layer A — the crossfade never moves layout.
  const styleB = useAnimatedStyle(() => {
    const j = Math.max(0, Math.min(WITHERING_FRAMES - 1, Math.ceil(progress.value)));
    const col = j % WITHERING_COLS;
    const row = Math.floor(j / WITHERING_COLS);
    const frac = progress.value - Math.floor(progress.value);
    const e = frac * frac * (3 - 2 * frac); // smoothstep: hold, then blend
    return {
      transform: [
        { translateX: -(col + INSET_L) * cellW },
        { translateY: -(row + INSET_T) * cellH },
      ],
      opacity: e,
    };
  });

  if (failed || !ready) {
    return (
      <View
        style={[styles.frame, { width, height }]}
        accessibilityRole="image"
        accessibilityLabel={owlMoodLabel(giveInsToday)}
      >
        <Image
          source={mascotMood(giveInsToday, isDark)}
          style={{ width, height }}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel={owlMoodLabel(giveInsToday)}
        />
        {/* Decode warm-up: same cached texture the layers use. No expo-asset
            in this project, so a 1px hidden Image forces the decode instead. */}
        {!failed && !ready && (
          <Image
            source={witheringSheet}
            style={styles.preload}
            onLoad={() => setReady(true)}
            onError={() => setFailed(true)}
            accessible={false}
          />
        )}
      </View>
    );
  }

  return (
    <View
      style={[styles.frame, { width, height }]}
      accessibilityRole="image"
      accessibilityLabel={owlMoodLabel(giveInsToday)}
    >
      <Animated.Image
        source={witheringSheet}
        onError={() => setFailed(true)}
        style={[{ width: sheetW, height: sheetH }, styles.sheet, styleA]}
        resizeMode="stretch"
        fadeDuration={0}
        accessible={false}
      />
      <Animated.Image
        source={witheringSheet}
        onError={() => setFailed(true)}
        style={[{ width: sheetW, height: sheetH }, styles.sheet, styleB]}
        resizeMode="stretch"
        fadeDuration={0}
        accessible={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent crop window: the sheet's own pixels (transparent backdrop)
  // composite over whatever card sits behind — no midnight/blue box, in
  // either theme. No radius: a rounded box would still read as a backdrop.
  frame: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  // Both crossfade layers share this box: absolute, identical size, moved
  // only by UI-thread transforms so frames never shift layout.
  sheet: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  // Off-screen decode warm-up; never participates in layout.
  preload: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
