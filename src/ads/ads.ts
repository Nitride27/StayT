// AdMob: consent -> init, rewarded (overrides), interstitial (session end).
// Unit ids live in ../../ads.txt; debug builds use Google's test units.
import mobileAds, {
  AdEventType,
  AdsConsent,
  InterstitialAd,
  RewardedAd,
  RewardedAdEventType,
  TestIds,
} from 'react-native-google-mobile-ads';
import { store } from '../storage/store';
import { adsFree } from '../billing/pro';

export const AD_UNITS = __DEV__
  ? { interstitial: TestIds.INTERSTITIAL, rewarded: TestIds.REWARDED, native: TestIds.NATIVE }
  : {
      interstitial: 'ca-app-pub-4286468826249164/4718493641',
      rewarded: 'ca-app-pub-4286468826249164/5808389040',
      native: 'ca-app-pub-4286468826249164/1992432961',
    };

// Hashed ids the SDK logs for our own phones: real units serve test ads there.
const TEST_DEVICES: string[] = [];

let ready: Promise<boolean> | null = null;

/** UMP consent first, then init. Resolves false when ads can't be requested. */
export function initAds(): Promise<boolean> {
  ready ??= (async () => {
    try {
      const info = await AdsConsent.gatherConsent().catch(() => AdsConsent.getConsentInfo());
      if (!info.canRequestAds) return false;
      await mobileAds().setRequestConfiguration({ testDeviceIdentifiers: TEST_DEVICES });
      await mobileAds().initialize();
      return true;
    } catch {
      return false;
    }
  })();
  return ready;
}

export async function showAds(): Promise<boolean> {
  const prefs = await store.getPreferences().catch(() => null);
  if (prefs && adsFree(prefs)) return false;
  return initAds();
}

/**
 * Rewarded ad. 'unavailable' = no consent / no fill / offline — callers
 * decide whether that fails open (overrides) or closed (unlocks).
 */
export async function showRewarded(): Promise<'earned' | 'dismissed' | 'unavailable'> {
  if (!(await initAds())) return 'unavailable';
  return new Promise(resolve => {
    const ad = RewardedAd.createForAdRequest(AD_UNITS.rewarded);
    let earned = false;
    let loaded = false;
    const done = (r: 'earned' | 'dismissed' | 'unavailable') => {
      unsubs.forEach(u => u());
      clearTimeout(timer);
      resolve(r);
    };
    // A slow network must not hold an override hostage.
    const timer = setTimeout(() => { if (!loaded) done('unavailable'); }, 10000);
    const unsubs = [
      ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        loaded = true;
        ad.show().catch(() => done('unavailable'));
      }),
      ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }),
      ad.addAdEventListener(AdEventType.CLOSED, () => done(earned ? 'earned' : 'dismissed')),
      ad.addAdEventListener(AdEventType.ERROR, () => done(earned ? 'earned' : 'unavailable')),
    ];
    ad.load();
  });
}

// Interstitial: preloaded, shown only if ready, at most once per 3 min.
const INTERSTITIAL_GAP_MS = 3 * 60 * 1000;
let interstitial: InterstitialAd | null = null;
let interstitialLoaded = false;
let lastInterstitialAt = 0;

export async function preloadInterstitial(): Promise<void> {
  if (interstitial || !(await showAds())) return;
  const ad = InterstitialAd.createForAdRequest(AD_UNITS.interstitial);
  interstitial = ad;
  ad.addAdEventListener(AdEventType.LOADED, () => { interstitialLoaded = true; });
  ad.addAdEventListener(AdEventType.ERROR, () => { interstitial = null; interstitialLoaded = false; });
  ad.addAdEventListener(AdEventType.CLOSED, () => {
    interstitial = null;
    interstitialLoaded = false;
    preloadInterstitial().catch(() => {});
  });
  ad.load();
}

/**
 * Never waits on the network: no ready ad = no ad. When one shows, resolves
 * only after it closes — navigating under a showing ad mounts screens while
 * the activity is paused and freezes their entry animations (blank screen).
 */
export async function maybeShowInterstitial(): Promise<void> {
  const ad = interstitial;
  if (!ad || !interstitialLoaded) { preloadInterstitial().catch(() => {}); return; }
  if (Date.now() - lastInterstitialAt < INTERSTITIAL_GAP_MS) return;
  if (!(await showAds())) return;
  lastInterstitialAt = Date.now();
  await new Promise<void>(resolve => {
    const unsubs = [
      ad.addAdEventListener(AdEventType.CLOSED, () => { unsubs.forEach(u => u()); resolve(); }),
      ad.addAdEventListener(AdEventType.ERROR, () => { unsubs.forEach(u => u()); resolve(); }),
    ];
    ad.show().catch(() => { unsubs.forEach(u => u()); resolve(); });
  });
}
