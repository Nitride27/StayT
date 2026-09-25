// StayT mascot expressions — static requires (Metro needs literal paths).
// Names verified against the actual art. White variants are generated from
// the black art (see assets/mascot/white/) for dark backgrounds.
import type { ImageSourcePropType } from 'react-native';

export const mascotExpressions = {
  working: require('../../assets/mascot/working.png'),
  laptop: require('../../assets/mascot/laptop.png'),
  reading: require('../../assets/mascot/reading.png'),
  blocked: require('../../assets/mascot/blocked.png'),
  music: require('../../assets/mascot/music.png'),
  phone: require('../../assets/mascot/phone.png'),
  thinking: require('../../assets/mascot/thinking.png'),
  waving: require('../../assets/mascot/waving.png'),
  leaving: require('../../assets/mascot/leaving.png'),
  coffee: require('../../assets/mascot/coffee.png'),
  cheering: require('../../assets/mascot/cheering.png'),
  peeking: require('../../assets/mascot/peeking.png'),
} as Record<string, ImageSourcePropType>;

export const mascotExpressionsWhite = {
  working: require('../../assets/mascot/white/working.png'),
  laptop: require('../../assets/mascot/white/laptop.png'),
  reading: require('../../assets/mascot/white/reading.png'),
  blocked: require('../../assets/mascot/white/blocked.png'),
  music: require('../../assets/mascot/white/music.png'),
  phone: require('../../assets/mascot/white/phone.png'),
  thinking: require('../../assets/mascot/white/thinking.png'),
  waving: require('../../assets/mascot/white/waving.png'),
  leaving: require('../../assets/mascot/white/leaving.png'),
  coffee: require('../../assets/mascot/white/coffee.png'),
  cheering: require('../../assets/mascot/white/cheering.png'),
  peeking: require('../../assets/mascot/white/peeking.png'),
} as Record<string, ImageSourcePropType>;

export type MascotExpression = keyof typeof mascotExpressions;

export function mascotSource(expr: MascotExpression, isDark: boolean): ImageSourcePropType {
  return isDark ? mascotExpressionsWhite[expr] : mascotExpressions[expr];
}

// Wave 2C2 owl loss-state (additive, no change to existing above).
// No new art: expression pick only. 0 give-ins → cheering, 1-2 → working,
// >2 → blocked (renderers dim via opacity, see call sites).
export function mascotMood(giveInsToday: number, isDark: boolean): ImageSourcePropType {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? giveInsToday : 0;
  if (n > 2) return mascotSource('blocked', isDark);
  if (n >= 1) return mascotSource('working', isDark);
  return mascotSource('cheering', isDark);
}

// Wave 2C2 mood copy (additive). Single source for TaskPicker + History.
export function owlMoodLabel(giveInsToday: number): string {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? giveInsToday : 0;
  if (n > 2) return 'Rough day. Bounce back tomorrow.';
  if (n >= 1) return 'A wobble or two. Still steady.';
  return 'Owl is sharp today.';
}

// Withering owl: 15 KEY POSES, not the raw 56-frame sequence. The source
// frames (assets/refined_frames_aligned, kept as source art — not bundled)
// disagree frame-to-frame (size, leaf positions, the face appearing and
// vanishing), and missing numbers at stage seams made pose pops: played in
// full it reads as jitter no matter how it's rendered (on-device capture).
// Keys, from that sequence: 0 4 9 14 19 22 25 28 32 37 41 46 49 52 55 —
// happy → sad → crouch → mound → glow → gone. WitheringOwl dissolves
// between neighbours on the UI thread. Regenerate with the key script;
// do not hand-edit.
export const WITHERING_FRAMES = 15;
/** Per-key step while the owl withers/recovers: ~1.8s for the full arc. The
 * in-out easing on the sweep lets the end poses hold. */
export const WITHERING_FRAME_MS = 130;

/** Light theme: plain art, like every light-mode mascot. */
export const WITHERING_FRAMES_LIST: ImageSourcePropType[] = [
  require('../../assets/wither_light/k00.png'),
  require('../../assets/wither_light/k01.png'),
  require('../../assets/wither_light/k02.png'),
  require('../../assets/wither_light/k03.png'),
  require('../../assets/wither_light/k04.png'),
  require('../../assets/wither_light/k05.png'),
  require('../../assets/wither_light/k06.png'),
  require('../../assets/wither_light/k07.png'),
  require('../../assets/wither_light/k08.png'),
  require('../../assets/wither_light/k09.png'),
  require('../../assets/wither_light/k10.png'),
  require('../../assets/wither_light/k11.png'),
  require('../../assets/wither_light/k12.png'),
  require('../../assets/wither_light/k13.png'),
  require('../../assets/wither_light/k14.png'),
];

/**
 * Dark theme: the same keys at 1.5x with the white sticker outline every
 * dark-mode mascot has (assets/mascot/white) — without it the black owl
 * dissolves into the pure-black background. Same aspect as the light set.
 */
export const WITHERING_FRAMES_LIST_DARK: ImageSourcePropType[] = [
  require('../../assets/wither_dark/k00.png'),
  require('../../assets/wither_dark/k01.png'),
  require('../../assets/wither_dark/k02.png'),
  require('../../assets/wither_dark/k03.png'),
  require('../../assets/wither_dark/k04.png'),
  require('../../assets/wither_dark/k05.png'),
  require('../../assets/wither_dark/k06.png'),
  require('../../assets/wither_dark/k07.png'),
  require('../../assets/wither_dark/k08.png'),
  require('../../assets/wither_dark/k09.png'),
  require('../../assets/wither_dark/k10.png'),
  require('../../assets/wither_dark/k11.png'),
  require('../../assets/wither_dark/k12.png'),
  require('../../assets/wither_dark/k13.png'),
  require('../../assets/wither_dark/k14.png'),
];

/** Theme-matched wither keys (light: plain, dark: outlined). */
export function witheringFrames(isDark: boolean): ImageSourcePropType[] {
  return isDark ? WITHERING_FRAMES_LIST_DARK : WITHERING_FRAMES_LIST;
}

/** Source pixel size of every key (all share one size). */
export const WITHERING_FRAME_SIZES: ReadonlyArray<readonly [number, number]> = [[193, 174]];
/** Fixed stage the keys play on (source px): contain-fit, centered. */
export const WITHERING_STAGE_W = 193;
export const WITHERING_STAGE_H = 174;

/**
 * Resting key for today's give-ins: 0 → happy (key 0), 1 → sad (key 2),
 * 2 → collapsed (key 7), 3 → glowing mound (key 11), 4+ → gone (key 14).
 * Mirrors the mascotMood/owlMoodLabel thresholds.
 */
export function witheringTargetFrame(giveInsToday: number): number {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? Math.max(0, Math.floor(giveInsToday)) : 0;
  if (n >= 4) return WITHERING_FRAMES - 1;
  if (n === 3) return 11;
  if (n === 2) return 7;
  if (n === 1) return 2;
  return 0;
}

// Wave 2C2 widget mood string (additive). Native mirror pending backend:
// 'bright' (0) | 'steady' (1-2) | 'wilted' (>2).
export function widgetMoodForGiveIns(giveInsToday: number): 'bright' | 'steady' | 'wilted' {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? giveInsToday : 0;
  if (n > 2) return 'wilted';
  if (n >= 1) return 'steady';
  return 'bright';
}
