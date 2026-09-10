// StayT Pro entitlement. Play product id — must exist in Play Console
// (one-time product) before purchases can succeed.
import { store } from '../storage/store';

export const PRO_SKU = 'stayt_pro';

export async function grantPro(): Promise<void> {
  const prefs = await store.getPreferences();
  if (!prefs.isSubscribed) {
    await store.savePreferences({ ...prefs, isSubscribed: true });
  }
}
