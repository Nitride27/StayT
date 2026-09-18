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

// Withering frames (additive). assets/whilting_away.png is 1536×1024,
// 5 cols × 6 rows = 30 frames on a uniform grid (no separator strips —
// the glow background is continuous): col edges [0,307,614,922,1229,1536],
// row edges [0,171,341,512,683,853,1024]. NOTE: filename keeps the source
// art's spelling ("whilting").
// Frames live in assets/owl/frame_XX.png as tight bg-removed crops (black
// body paint is identical to the dark glow, so flood-fill can't split
// them — extraction is anchor-based: white/green accents locate the
// subject, dark regions are kept near those anchors, neighbor-cell bleed
// is dropped). Do not hand-edit; re-export from the art.
// The old spritesheets (whithering_away.png, whithering_30.png) are retired.
// Withering sheet: 30 frames, 5 cols × 6 rows.
export const WITHERING_COLS = 5;
export const WITHERING_ROWS = 6;
export const WITHERING_FRAMES = WITHERING_COLS * WITHERING_ROWS; // 30
/** Per-frame step while the owl withers/recovers (brisk tick; the worklet-side smoothstep blend carries the softness). */
export const WITHERING_FRAME_MS = 110;
// Withering frames as INDIVIDUAL files (no spritesheet math): each file is
// its frame's tight bg-removed crop, so no frame can show another's art.
// Machine-exported 2026-09-18 from assets/whilting_away.png — do not
// hand-edit, re-export from the art.
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
  [192, 140], [152, 149], [148, 137], [145, 137], [147, 128],
  [196, 171], [188, 171], [183, 171], [187, 171], [192, 171],
  [161, 171], [168, 171], [164, 171], [173, 171], [144, 171],
  [173, 170], [182, 170], [188, 170], [220, 170], [194, 170],
  [183, 171], [187, 171], [189, 171], [207, 171], [202, 171],
  [187, 141], [155, 104], [138, 139], [141, 138], [149, 138],
];
/** Fixed stage all crops play on (source px): max tight-crop size — every
 * crop is contain-fit into it (smaller frames scale up), centered,
 * transparent padding elsewhere, zero layout shift. */
export const WITHERING_STAGE_W = 220;
export const WITHERING_STAGE_H = 171;

/**
 * Target wither frame for today's give-ins across the 30-frame arc: 0 →
 * bright (frame 0), 1 → end of row 1, 2 → end of row 2, 3 → end of row 3,
 * 4+ → full puddle (last frame). The sweep passes through every frame in
 * between. Mirrors the mascotMood/owlMoodLabel thresholds.
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
