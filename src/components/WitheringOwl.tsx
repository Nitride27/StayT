import React, { useEffect, useState } from 'react';
import { View, Image, StyleSheet, PixelRatio } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  withTiming,
  cancelAnimation,
  useReducedMotion,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import {
  mascotMood,
  owlMoodLabel,
  witheringTargetFrame,
  WITHERING_FRAMES_LIST,
  WITHERING_FRAME_SIZES,
  WITHERING_STAGE_W,
  WITHERING_STAGE_H,
  WITHERING_FRAME_MS,
  WITHERING_FRAMES,
} from '../theme/mascot';

type Props = {
  /** Today's give-in count — drives the wither target frame. */
  giveInsToday: number;
  /** Display width of the fixed stage; height follows the stage ratio. */
  width?: number;
  /** ms per frame step. Defaults to WITHERING_FRAME_MS. */
  frameMs?: number;
};

// Individual-frame animation: 30 files, one per frame, each bg-cleaned, so
// no frame can ever show another's art — there is no sheet math left. Both
// layers contain-fit their frame into the fixed transparent stage (max frame
// size), centered: zero layout shift, morph stays put.
const STAGE_RATIO = WITHERING_STAGE_H / WITHERING_STAGE_W;

/**
 * Animated loss-state owl: walks the 30 wither frames from 0 toward the
 * give-ins target (and back when the user recovers). Holds the target frame
 * when reached: no looping timers, no battery drain. While warming up (or
 * when a pair load fails) it holds the target OWL frame statically — the
 * static mascotMood expression is only a last resort if the frame art
 * itself fails to decode.
 *
 * Smoothness: a single `progress` shared value animates 0 → target on the UI
 * thread (one withTiming, linear for uniform step cadence). Image SOURCES
 * swap on the JS thread only when the integer frame changes (a few updates
 * per animation, via runOnJS); per-vsync work is opacity-only smoothstep
 * crossfade — each frame holds, then dissolves briskly instead of lingering
 * as a 50/50 ghost. Geometry snaps to device pixels. All 30 frames are
 * decode-warmed behind the static fallback before `ready` flips (with a
 * timeout escape so one slow file can't hang the owl). Reduced-motion users
 * snap straight to the target frame.
 */
export default function WitheringOwl({ giveInsToday, width = 96, frameMs = WITHERING_FRAME_MS }: Props) {
  const { isDark } = useTheme();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const [warmed, setWarmed] = useState(0);
  const [pair, setPair] = useState({ a: 0, b: 0 });
  const reduceMotion = useReducedMotion();
  const devicePx = Math.max(1, PixelRatio.get() || 1);
  const height = PixelRatio.roundToNearestPixel(width * STAGE_RATIO);
  const progress = useSharedValue(0);
  const seenPair = useSharedValue(0);

  // Display px per stage px.
  const s0 = width / WITHERING_STAGE_W;
  const snap = (v: number) => Math.round(v * devicePx) / devicePx;

  // Warm every frame up front; timeout escape so a slow file can't hang us.
  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setReady(true), 2500);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => {
    if (warmed >= WITHERING_FRAMES_LIST.length) setReady(true);
  }, [warmed]);

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

  // Sync integer frame pair to JS (sources + sizes live here, not in
  // worklets). Fires only when floor/ceil actually changes.
  useAnimatedReaction(
    () => {
      const a = Math.max(0, Math.min(WITHERING_FRAMES - 1, Math.floor(progress.value)));
      const b = Math.max(0, Math.min(WITHERING_FRAMES - 1, Math.ceil(progress.value)));
      return a * 100 + b;
    },
    (v) => {
      if (v !== seenPair.value) {
        seenPair.value = v;
        runOnJS(setPair)({ a: Math.floor(v / 100), b: v % 100 });
      }
    },
    [],
  );

  // Opacity-only worklets: cheap every vsync.
  const opacityA = useAnimatedStyle(() => {
    const frac = progress.value - Math.floor(progress.value);
    const e = frac * frac * (3 - 2 * frac); // smoothstep: hold, then blend
    return { opacity: 1 - e };
  });
  const opacityB = useAnimatedStyle(() => {
    const frac = progress.value - Math.floor(progress.value);
    const e = frac * frac * (3 - 2 * frac); // smoothstep: hold, then blend
    return { opacity: e };
  });

  // Contain-fit a frame's native size into the stage, centered.
  const fit = (idx: number) => {
    const fw = WITHERING_FRAME_SIZES[idx][0];
    const fh = WITHERING_FRAME_SIZES[idx][1];
    const s = s0 * Math.min(WITHERING_STAGE_W / fw, WITHERING_STAGE_H / fh);
    const w = fw * s;
    const h = fh * s;
    return {
      width: snap(w),
      height: snap(h),
      left: snap((width - w) / 2),
      top: snap((height - h) / 2),
    };
  };

  // Last resort: the owl art itself failed — static mascot expression.
  if (frameFailed) {
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
      </View>
    );
  }

  if (failed || !ready) {
    // Loading / pair-error fallback: the target OWL frame for today's
    // give-ins (same wither state the animation would hold) — never the
    // static blocked/working mascot. Decode warm-up runs behind it.
    const target = witheringTargetFrame(giveInsToday);
    return (
      <View
        style={[styles.frame, { width, height }]}
        accessibilityRole="image"
        accessibilityLabel={owlMoodLabel(giveInsToday)}
      >
        <Image
          source={WITHERING_FRAMES_LIST[target]}
          style={{ width, height }}
          resizeMode="contain"
          onError={() => setFrameFailed(true)}
          accessibilityRole="image"
          accessibilityLabel={owlMoodLabel(giveInsToday)}
        />
        {/* Decode warm-up: 1px hidden frames force the decode instead. */}
        {!failed && !ready && (
          <View style={styles.preloadWrap} accessible={false}>
            {WITHERING_FRAMES_LIST.map((src, k) => (
              <Image
                key={k}
                source={src}
                style={styles.preload}
                onLoad={() => setWarmed((w) => w + 1)}
                onError={() => setWarmed((w) => w + 1)}
                accessible={false}
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  const styleA = fit(pair.a);
  const styleB = fit(pair.b);
  // Base layer: the static target frame for today's give-ins, always
  // mounted under the crossfade pair. If a pair frame isn't decoded yet
  // when the sweep reaches it (slow decode after the warm-up timeout), the
  // correct owl shows through instead of a blank flash — the owl can never
  // intermittently disappear mid-run. Costs one small static image.
  const targetFrame = witheringTargetFrame(giveInsToday);
  const styleT = fit(targetFrame);

  return (
    <View
      style={[styles.frame, { width, height }]}
      accessibilityRole="image"
      accessibilityLabel={owlMoodLabel(giveInsToday)}
    >
      <View style={[styles.layer, styleT]} accessible={false}>
        <Image
          source={WITHERING_FRAMES_LIST[targetFrame]}
          onError={() => setFailed(true)}
          style={{ width: styleT.width, height: styleT.height }}
          resizeMode="stretch"
          fadeDuration={0}
          accessible={false}
        />
      </View>
      <Animated.View style={[styles.layer, styleA, opacityA]}>
        <Animated.Image
          source={WITHERING_FRAMES_LIST[pair.a]}
          onError={() => setFailed(true)}
          style={{ width: styleA.width, height: styleA.height }}
          resizeMode="stretch"
          fadeDuration={0}
          accessible={false}
        />
      </Animated.View>
      <Animated.View style={[styles.layer, styleB, opacityB]}>
        <Animated.Image
          source={WITHERING_FRAMES_LIST[pair.b]}
          onError={() => setFailed(true)}
          style={{ width: styleB.width, height: styleB.height }}
          resizeMode="stretch"
          fadeDuration={0}
          accessible={false}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent fixed stage: frames composite over the screen bg in either
  // theme. No radius: a rounded box would still read as a backdrop.
  frame: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  // Crossfade layers: absolute, contain-fit sized, centered. Opacity comes
  // from the animated styles; geometry is static per render.
  layer: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  // Off-screen decode warm-up; never participates in layout.
  preloadWrap: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  preload: {
    width: 1,
    height: 1,
  },
});
