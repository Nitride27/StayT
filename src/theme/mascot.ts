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
  if (n > 2) return 'Rough day — bounce back tomorrow.';
  if (n >= 1) return 'A wobble or two — steady.';
  return 'Owl is sharp today.';
}

// Withering frames (additive). Source: assets/refined_frames_aligned/
// (56 files: idle_a 00-09, idle_b 10-19, crouch 20-28, mound_sprout 30-38,
// mound_glow 40-48, wilt_gone 50-58) — pre-aligned, uniform 193×174,
// bg-removed. Referenced in place (original names kept); assets/owl/ is
// retired and deleted. Do not hand-edit; re-export from the art.
// Withering animation: 56 frames in narrative order; frame i simply plays
// after frame i-1 (no grid math — files are individual).
export const WITHERING_FRAMES = 56;
/** Per-frame step while the owl withers/recovers: 17ms ≈ 60fps. Rendering
 * is every vsync regardless; this sets the sweep pace (~0.95s full arc).
 * The in-out easing on the sweep preserves the end-pose holds. */
export const WITHERING_FRAME_MS = 17;
// Withering frames as INDIVIDUAL files (no spritesheet math): each file is
// a finished sprite, so no frame can show another's art. All are 193×174,
// hence identical sizes below. Do not hand-edit; re-export from the art.
export const WITHERING_FRAMES_LIST: ImageSourcePropType[] = [
  require('../../assets/refined_frames_aligned/frame_00_idle_a.png'), require('../../assets/refined_frames_aligned/frame_01_idle_a.png'),
  require('../../assets/refined_frames_aligned/frame_02_idle_a.png'), require('../../assets/refined_frames_aligned/frame_03_idle_a.png'),
  require('../../assets/refined_frames_aligned/frame_04_idle_a.png'), require('../../assets/refined_frames_aligned/frame_05_idle_a.png'),
  require('../../assets/refined_frames_aligned/frame_06_idle_a.png'), require('../../assets/refined_frames_aligned/frame_07_idle_a.png'),
  require('../../assets/refined_frames_aligned/frame_08_idle_a.png'), require('../../assets/refined_frames_aligned/frame_09_idle_a.png'),
  require('../../assets/refined_frames_aligned/frame_10_idle_b.png'), require('../../assets/refined_frames_aligned/frame_11_idle_b.png'),
  require('../../assets/refined_frames_aligned/frame_12_idle_b.png'), require('../../assets/refined_frames_aligned/frame_13_idle_b.png'),
  require('../../assets/refined_frames_aligned/frame_14_idle_b.png'), require('../../assets/refined_frames_aligned/frame_15_idle_b.png'),
  require('../../assets/refined_frames_aligned/frame_16_idle_b.png'), require('../../assets/refined_frames_aligned/frame_17_idle_b.png'),
  require('../../assets/refined_frames_aligned/frame_18_idle_b.png'), require('../../assets/refined_frames_aligned/frame_19_idle_b.png'),
  require('../../assets/refined_frames_aligned/frame_20_crouch.png'), require('../../assets/refined_frames_aligned/frame_21_crouch.png'),
  require('../../assets/refined_frames_aligned/frame_22_crouch.png'), require('../../assets/refined_frames_aligned/frame_23_crouch.png'),
  require('../../assets/refined_frames_aligned/frame_24_crouch.png'), require('../../assets/refined_frames_aligned/frame_25_crouch.png'),
  require('../../assets/refined_frames_aligned/frame_26_crouch.png'), require('../../assets/refined_frames_aligned/frame_27_crouch.png'),
  require('../../assets/refined_frames_aligned/frame_28_crouch.png'), require('../../assets/refined_frames_aligned/frame_30_mound_sprout.png'),
  require('../../assets/refined_frames_aligned/frame_31_mound_sprout.png'), require('../../assets/refined_frames_aligned/frame_32_mound_sprout.png'),
  require('../../assets/refined_frames_aligned/frame_33_mound_sprout.png'), require('../../assets/refined_frames_aligned/frame_34_mound_sprout.png'),
  require('../../assets/refined_frames_aligned/frame_35_mound_sprout.png'), require('../../assets/refined_frames_aligned/frame_36_mound_sprout.png'),
  require('../../assets/refined_frames_aligned/frame_37_mound_sprout.png'), require('../../assets/refined_frames_aligned/frame_38_mound_sprout.png'),
  require('../../assets/refined_frames_aligned/frame_40_mound_glow.png'), require('../../assets/refined_frames_aligned/frame_41_mound_glow.png'),
  require('../../assets/refined_frames_aligned/frame_42_mound_glow.png'), require('../../assets/refined_frames_aligned/frame_43_mound_glow.png'),
  require('../../assets/refined_frames_aligned/frame_44_mound_glow.png'), require('../../assets/refined_frames_aligned/frame_45_mound_glow.png'),
  require('../../assets/refined_frames_aligned/frame_46_mound_glow.png'), require('../../assets/refined_frames_aligned/frame_47_mound_glow.png'),
  require('../../assets/refined_frames_aligned/frame_48_mound_glow.png'), require('../../assets/refined_frames_aligned/frame_50_wilt_gone.png'),
  require('../../assets/refined_frames_aligned/frame_51_wilt_gone.png'), require('../../assets/refined_frames_aligned/frame_52_wilt_gone.png'),
  require('../../assets/refined_frames_aligned/frame_53_wilt_gone.png'), require('../../assets/refined_frames_aligned/frame_54_wilt_gone.png'),
  require('../../assets/refined_frames_aligned/frame_55_wilt_gone.png'), require('../../assets/refined_frames_aligned/frame_56_wilt_gone.png'),
  require('../../assets/refined_frames_aligned/frame_57_wilt_gone.png'), require('../../assets/refined_frames_aligned/frame_58_wilt_gone.png'),
];
/** Native pixel sizes matching WITHERING_FRAMES_LIST order. */
export const WITHERING_FRAME_SIZES: ReadonlyArray<readonly [number, number]> = [
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174], [193, 174], [193, 174], [193, 174], [193, 174],
  [193, 174],
];
/** Fixed stage all crops play on (source px): max tight-crop size — every
 * crop is contain-fit into it (smaller frames scale up), centered,
 * transparent padding elsewhere, zero layout shift. */
export const WITHERING_STAGE_W = 193;
export const WITHERING_STAGE_H = 174;

/**
 * Target wither frame for today's give-ins across the 56-frame arc, resting
 * at stage ends: 0 → bright idle (frame 0), 1 → idle_a end, 2 → crouch end
 * (frame 28), 3 → mound_glow end (frame 46), 4+ → wilted away (last frame).
 * The sweep passes through every frame in between. Mirrors the
 * mascotMood/owlMoodLabel thresholds.
 */
export function witheringTargetFrame(giveInsToday: number): number {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? Math.max(0, Math.floor(giveInsToday)) : 0;
  if (n >= 4) return WITHERING_FRAMES - 1;
  if (n === 3) return 46;
  if (n === 2) return 28;
  if (n === 1) return 9;
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
