// StayT mascot expressions — static requires (Metro needs literal paths).
// NOTE: filenames are provisional; verify against actual art before renaming.
import type { ImageSourcePropType } from 'react-native';

export const mascotExpressions = {
  happy: require('../../assets/mascot/happy.png'),
  working: require('../../assets/mascot/working.png'),
  thumbsUp: require('../../assets/mascot/thumbs_up.png'),
  ok: require('../../assets/mascot/ok.png'),
  starEyes: require('../../assets/mascot/star_eyes.png'),
  heartEyes: require('../../assets/mascot/heart_eyes.png'),
  thinking: require('../../assets/mascot/thinking.png'),
  wink: require('../../assets/mascot/wink.png'),
  sad: require('../../assets/mascot/sad.png'),
  crying: require('../../assets/mascot/crying.png'),
  angry: require('../../assets/mascot/angry.png'),
  sleeping: require('../../assets/mascot/sleeping.png'),
} as Record<string, ImageSourcePropType>;

export type MascotExpression = keyof typeof mascotExpressions;
