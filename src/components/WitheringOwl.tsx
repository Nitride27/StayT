import React, { useEffect, useState } from 'react';
import { View, Image, StyleSheet, PixelRatio, ImageSourcePropType } from 'react-native';
import Animated, {
  SharedValue,
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation,
  useReducedMotion,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeContext';
import {
  mascotMood,
  owlMoodLabel,
  witheringTargetFrame,
  witheringFrames,
  WITHERING_FRAME_SIZES,
  WITHERING_STAGE_W,
  WITHERING_STAGE_H,
  WITHERING_FRAME_MS,
} from '../theme/mascot';

type Props = {
  /** Today's give-in count — drives the wither target frame. */
  giveInsToday: number;
  /** Display width of the fixed stage; height follows the stage ratio. */
  width?: number;
  /** ms per frame step. Defaults to WITHERING_FRAME_MS. */
  frameMs?: number;
};

const STAGE_RATIO = WITHERING_STAGE_H / WITHERING_STAGE_W;
// Decode head start before the first sweep: every frame is mounted from the
// start, so this only has to cover the first decode of local bundled PNGs.
const WARM_MS = 450;

/**
 * Animated loss-state owl: dissolves through the wither KEY POSES (see
 * mascot.ts — the raw frames flicker), from the healthy owl (key 0) to
 * today's give-ins target, and holds there.
 *
 * Why a flipbook (on-device M52 capture): the old crossfade swapped image
 * SOURCES from JS (runOnJS) while progress ran on the UI thread, so frames
 * landed late or out of order (visible stutter spikes), and the loading
 * placeholder showed the END pose, then popped back to frame 0 before the
 * sweep. Source swaps on images with load callbacks also crashed Fresco.
 *
 * Now every key is mounted once, stacked, with a fixed source; each key's
 * opacity is derived on the UI thread from one `progress` shared value
 * (no JS per frame, no source swaps). The
 * sweep starts at frame 0 after a short decode head start, eased in-out so
 * the key poses hold. Reduced-motion users snap to the target. A healthy
 * owl breathes gently at rest.
 */
export default function WitheringOwl({ giveInsToday, width = 96, frameMs = WITHERING_FRAME_MS }: Props) {
  const { isDark } = useTheme();
  const [artFailed, setArtFailed] = useState(false);
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const breath = useSharedValue(0);
  const frames = witheringFrames(isDark);
  const target = witheringTargetFrame(giveInsToday);
  const idle = target <= 9;

  const height = PixelRatio.roundToNearestPixel(width * STAGE_RATIO);
  // All frames share one size: one contain-fit rect, snapped to device px.
  const devicePx = Math.max(1, PixelRatio.get() || 1);
  const snap = (v: number) => Math.round(v * devicePx) / devicePx;
  const [fw, fh] = WITHERING_FRAME_SIZES[0];
  const s = (width / WITHERING_STAGE_W) * Math.min(WITHERING_STAGE_W / fw, WITHERING_STAGE_H / fh);
  const rect = {
    width: snap(fw * s),
    height: snap(fh * s),
    left: snap((width - fw * s) / 2),
    top: snap((height - fh * s) / 2),
  };

  // Sweep toward today's target. First run gets the decode head start; later
  // changes (give-ins while mounted) sweep from wherever the owl is.
  const firstRun = React.useRef(true);
  useEffect(() => {
    const from = progress.value;
    if (reduceMotion) {
      progress.value = target;
      return;
    }
    const duration = Math.max(1, Math.abs(target - from) * Math.max(16, frameMs));
    const sweep = withTiming(target, { duration, easing: Easing.inOut(Easing.cubic) });
    progress.value = firstRun.current ? withDelay(WARM_MS, sweep) : sweep;
    firstRun.current = false;
    return () => cancelAnimation(progress);
  }, [target, frameMs, reduceMotion, progress]);

  // Idle breath: a slow swell + lift while the owl is healthy, so a good day
  // looks alive. Wilted poses stay still; no loop for reduced motion.
  useEffect(() => {
    if (reduceMotion || !idle) {
      cancelAnimation(breath);
      breath.value = withTiming(0, { duration: 300 });
      return;
    }
    const half = { duration: 1400, easing: Easing.inOut(Easing.sin) };
    breath.value = withDelay(
      WARM_MS,
      withRepeat(withSequence(withTiming(1, half), withTiming(0, half)), -1, false),
    );
    return () => cancelAnimation(breath);
  }, [reduceMotion, idle, breath]);
  const breathStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * breath.value }, { scale: 1 + 0.02 * breath.value }],
  }));

  // Last resort: the frame art failed to decode — static mascot expression.
  if (artFailed) {
    return (
      <View style={[styles.frame, { width, height }]} accessibilityRole="image" accessibilityLabel={owlMoodLabel(giveInsToday)}>
        <Image source={mascotMood(giveInsToday, isDark)} style={{ width, height }} resizeMode="contain" />
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.frame, { width, height }, breathStyle]}
      accessibilityRole="image"
      accessibilityLabel={owlMoodLabel(giveInsToday)}
    >
      {frames.map((src, idx) => (
        <FlipFrame
          key={idx}
          idx={idx}
          src={src}
          rect={rect}
          progress={progress}
          // Only frame 0 (fixed source) reports errors: callbacks on many
          // images were the Fresco crash path.
          onError={idx === 0 ? () => setArtFailed(true) : undefined}
        />
      ))}
    </Animated.View>
  );
}

type FrameProps = {
  idx: number;
  src: ImageSourcePropType;
  rect: { width: number; height: number; left: number; top: number };
  progress: SharedValue<number>;
  onError?: () => void;
};

/**
 * One key pose. Between keys i and i+1 (t = progress - i): the upper key
 * fades IN over the first half while the lower stays solid, then the lower
 * fades OUT — the owl never turns see-through mid-dissolve (a plain 50/50
 * crossfade reads as a ghost). Keys stack in index order, so the higher key
 * draws on top. At an integer progress exactly one key is visible.
 */
function FlipFrame({ idx, src, rect, progress, onError }: FrameProps) {
  const visible = useAnimatedStyle(() => {
    const d = progress.value - idx;
    if (d <= -1 || d >= 1) return { opacity: 0 };
    if (d >= 0) return { opacity: d < 0.5 ? 1 : 2 * (1 - d) }; // lower of the pair
    const t = 1 + d; // upper of the pair
    return { opacity: t < 0.5 ? 2 * t : 1 };
  });
  return (
    <Animated.View style={[styles.layer, rect, visible]} accessible={false}>
      <Image
        source={src}
        style={{ width: rect.width, height: rect.height }}
        resizeMode="stretch"
        fadeDuration={0}
        onError={onError}
        accessible={false}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Transparent fixed stage: frames composite over the screen bg in either
  // theme. No radius: a rounded box would still read as a backdrop.
  frame: {
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  layer: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
});
