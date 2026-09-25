// no-pro build: no purchases. Pro features unlock for PRO_PASS_HOURS per
// rewarded ad watched; ads never switch off.
import { store } from '../storage/store';
import { syncWidgetNow } from '../widget/widgetSync';

export const PRO_PASS_HOURS = 24;

export async function grantProPass(): Promise<void> {
  const prefs = await store.getPreferences();
  // Stacks: watching again while active adds on top of what is left.
  const base = Math.max(Date.now(), prefs.proPassUntil ?? 0);
  await store.savePreferences({ ...prefs, proPassUntil: base + PRO_PASS_HOURS * 3600 * 1000 });
  // Refresh the widget/tile entitlement mirror (P2-2 reads it with app dead).
  // ponytail: the mirror only updates on sync, so the tile can outlive an
  // expired pass until the next app open; add an expiry field to WidgetData if that matters.
  await syncWidgetNow().catch(() => {});
}

// Single Pro seam: every gate reads this. isSubscribed stays only for the
// __DEV__ toggle in Settings.
export function isPro(prefs: { isSubscribed?: boolean; proPassUntil?: number }): boolean {
  return prefs.isSubscribed === true || (prefs.proPassUntil ?? 0) > Date.now();
}

export const adsFree = (_prefs: unknown) => false;
