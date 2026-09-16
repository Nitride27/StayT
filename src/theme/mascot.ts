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

// Withering sprite sheet (additive). assets/whithering_away.png is a 5-col ×
// 4-row grid (1536×1024 → ~307×256 cells): row 1 standing→drooping, row 2
// wilting→collapsed, row 3 leafy mound, row 4 mound→puddle. Single dark-bg
// sheet, so it renders the same in both themes (framed on midnight).
// NOTE: filename keeps the repo's existing spelling ("whithering").
export const witheringSheet: ImageSourcePropType = require('../../assets/whithering_away.png');
export const WITHERING_COLS = 5;
export const WITHERING_ROWS = 4;
export const WITHERING_FRAMES = WITHERING_COLS * WITHERING_ROWS;
/** Per-frame step while the owl withers/recovers. */
export const WITHERING_FRAME_MS = 130;

/**
 * Target wither frame for today's give-ins: 0 → bright (frame 0), 1 →
 * droopy (end of row 1), 2 → slumped (row 2), 3 → mound (row 3), 4+ → full
 * puddle (last frame). Mirrors the mascotMood/owlMoodLabel thresholds.
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
