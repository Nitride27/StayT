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
