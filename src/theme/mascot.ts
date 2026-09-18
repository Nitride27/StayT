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

// Withering frames (additive). Source: assets/whilting_away_frames_aligned/
// (30 files, 6 stages × 5: idle_blink, battery, crouch_leaves,
// mound_sprout, mound_glow, wilt_gone) — pre-aligned, uniform 234×171,
// bg-removed. NOTE: source folder keeps the art's spelling ("whilting").
// Frames live in assets/owl/frame_XX.png in stage order (00-04 idle …
// 25-29 gone). Do not hand-edit; re-export from the art.
// The old spritesheets (whithering_away.png, whithering_30.png,
// whilting_away.png uniform-grid crops) are retired.
// Withering animation: 30 frames in narrative order; frame i simply plays
// after frame i-1 (no grid math — files are individual).
export const WITHERING_COLS = 5;
export const WITHERING_ROWS = 6;
export const WITHERING_FRAMES = WITHERING_COLS * WITHERING_ROWS; // 30
/** Per-frame step while the owl withers/recovers (brisk tick; the worklet-side smoothstep blend carries the softness). */
export const WITHERING_FRAME_MS = 110;
// Withering frames as INDIVIDUAL files (no spritesheet math): each file is
// a finished sprite, so no frame can show another's art. All are 234×171,
// hence identical sizes below. Do not hand-edit; re-export from the art.
export const WITHERING_FRAMES_LIST: ImageSourcePropType[] = [
  require('../../assets/owl/frame_00.png'), require('../../assets/owl/frame_01.png'),
  require('../../assets/owl/frame_02.png'), require('../../assets/owl/frame_03.png'),
  require('../../assets/owl/frame_04.png'), require('../../assets/owl/frame_05.png'),
  require('../../assets/owl/frame_06.png'), require('../../assets/owl/frame_07.png'),
  require('../../assets/owl/frame_08.png'), require('../../assets/owl/frame_09.png'),
  require('../../assets/owl/frame_10.png'), require('../../assets/owl/frame_11.png'),
  require('../../assets/owl/frame_12.png'), require('../../assets/owl/frame_13.png'),
  require('../../assets/owl/frame_14.png'), require('../../assets/owl/frame_15.png'),
  require('../../assets/owl/frame_16.png'), require('../../assets/owl/frame_17.png'),
  require('../../assets/owl/frame_18.png'), require('../../assets/owl/frame_19.png'),
  require('../../assets/owl/frame_20.png'), require('../../assets/owl/frame_21.png'),
  require('../../assets/owl/frame_22.png'), require('../../assets/owl/frame_23.png'),
  require('../../assets/owl/frame_24.png'), require('../../assets/owl/frame_25.png'),
  require('../../assets/owl/frame_26.png'), require('../../assets/owl/frame_27.png'),
  require('../../assets/owl/frame_28.png'), require('../../assets/owl/frame_29.png'),
];
/** Native pixel sizes matching WITHERING_FRAMES_LIST order. */
export const WITHERING_FRAME_SIZES: ReadonlyArray<readonly [number, number]> = [
  [234, 171], [234, 171], [234, 171], [234, 171], [234, 171],
  [234, 171], [234, 171], [234, 171], [234, 171], [234, 171],
  [234, 171], [234, 171], [234, 171], [234, 171], [234, 171],
  [234, 171], [234, 171], [234, 171], [234, 171], [234, 171],
  [234, 171], [234, 171], [234, 171], [234, 171], [234, 171],
  [234, 171], [234, 171], [234, 171], [234, 171], [234, 171],
];
/** Fixed stage all crops play on (source px): max tight-crop size — every
 * crop is contain-fit into it (smaller frames scale up), centered,
 * transparent padding elsewhere, zero layout shift. */
export const WITHERING_STAGE_W = 234;
export const WITHERING_STAGE_H = 171;

/**
 * Target wither frame for today's give-ins across the 30-frame arc: 0 →
 * bright (frame 0, idle), 1 → idle end, 2 → battery drained (frame 9),
 * 3 → crouch end (frame 14), 4+ → wilted away (last frame). The sweep
 * passes through every frame in between. Mirrors the
 * mascotMood/owlMoodLabel thresholds.
 */
export function witheringTargetFrame(giveInsToday: number): number {
  const n = typeof giveInsToday === 'number' && Number.isFinite(giveInsToday) ? Math.max(0, Math.floor(giveInsToday)) : 0;
  if (n >= 4) return WITHERING_FRAMES - 1;
  if (n === 3) return 14;
  if (n === 2) return 9;
  if (n === 1) return 4;
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
