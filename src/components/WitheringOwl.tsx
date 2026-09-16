import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import {
  witheringSheet,
  mascotMood,
  owlMoodLabel,
  witheringTargetFrame,
  WITHERING_COLS,
  WITHERING_ROWS,
  WITHERING_FRAME_MS,
} from '../theme/mascot';

type Props = {
  /** Today's give-in count — drives the wither target frame. */
  giveInsToday: number;
  /** Display width of one frame; height follows the sheet cell ratio. */
  width?: number;
  /** ms per frame step. Defaults to WITHERING_FRAME_MS. */
  frameMs?: number;
};

// Source cell ratio: 1536/5 wide × 1024/4 tall.
const CELL_RATIO = 256 / 307.2;

/**
 * Animated loss-state owl: steps through the whithering_away sprite sheet
 * from frame 0 toward the give-ins target (and back when the user recovers —
 * the same interval walks both directions, so tomorrow's fresh owl perks back
 * up). Holds the target frame when reached: no looping timers, no battery
 * drain. A failed sheet load falls back to the static mascotMood expression.
 */
export default function WitheringOwl({ giveInsToday, width = 64, frameMs = WITHERING_FRAME_MS }: Props) {
  const { isDark } = useTheme();
  const [frame, setFrame] = useState(0);
  const [failed, setFailed] = useState(false);
  const frameRef = useRef(0);
  const height = Math.round(width * CELL_RATIO);

  useEffect(() => {
    if (failed) return;
    const target = witheringTargetFrame(giveInsToday);
    if (target === frameRef.current) return;
    const step = target > frameRef.current ? 1 : -1;
    const id = setInterval(() => {
      frameRef.current += step;
      setFrame(frameRef.current);
      if (frameRef.current === target) clearInterval(id);
    }, Math.max(30, frameMs));
    return () => clearInterval(id);
  }, [giveInsToday, frameMs, failed]);

  if (failed) {
    return (
      <Image
        source={mascotMood(giveInsToday, isDark)}
        style={{ width, height }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={owlMoodLabel(giveInsToday)}
      />
    );
  }

  const col = frame % WITHERING_COLS;
  const row = Math.floor(frame / WITHERING_COLS) % WITHERING_ROWS;

  return (
    <View
      style={[styles.frame, { width, height }]}
      accessibilityRole="image"
      accessibilityLabel={owlMoodLabel(giveInsToday)}
    >
      <Image
        source={witheringSheet}
        onError={() => setFailed(true)}
        style={{
          width: width * WITHERING_COLS,
          height: height * WITHERING_ROWS,
          position: 'absolute',
          left: -col * width,
          top: -row * height,
        }}
        resizeMode="stretch"
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
});
