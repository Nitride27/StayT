// StayT Pro entitlement. Play product id — must exist in Play Console
// (one-time product) before purchases can succeed.
import { store } from '../storage/store';
import { syncWidgetNow } from '../widget/widgetSync';

export const PRO_SKU = 'stayt_pro';

export async function grantPro(): Promise<void> {
  const prefs = await store.getPreferences();
  if (!prefs.isSubscribed) {
    await store.savePreferences({ ...prefs, isSubscribed: true });
  }
  // Refresh the widget/tile entitlement mirror (P2-2 reads it with app dead).
  await syncWidgetNow().catch(() => {});
}

// Single Pro seam: every gate reads this, never prefs.isSubscribed directly
// (the no-pro branch swaps only this body for an ad-unlocked pass).
export function isPro(prefs: { isSubscribed?: boolean }): boolean {
  return prefs.isSubscribed === true;
}

// Pro removes every ad except the rewarded one in front of overrides.
export const adsFree = isPro;
