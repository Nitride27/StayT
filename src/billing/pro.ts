// no-pro build: no purchases. Every Pro feature is enforced once saved;
// turning one on plays a rewarded ad first, every time (adGate).
import { Alert } from 'react-native';
import { showRewarded } from '../ads/ads';

// Single Pro seam for enforcement: always on here, the gate is the ad.
export function isPro(_prefs: unknown): boolean {
  return true;
}

export const adsFree = (_prefs: unknown) => false;

/** Rewarded ad in front of enabling a Pro feature. True = go ahead. */
export async function adGate(): Promise<boolean> {
  const result = await showRewarded();
  if (result === 'earned') return true;
  if (result === 'unavailable') {
    Alert.alert('No ad available', 'Pro features turn on after a short ad. Check your connection and try again.');
  }
  return false;
}
