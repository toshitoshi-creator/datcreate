import type { AdPort } from '../engine/ads';
import { isNativeApp } from './nativeNotifications';

/*
 * AdMob rewarded ads in the iOS / Android app (@capacitor-community/admob).
 * Ad unit ids come from build-time env vars; without them Google's public
 * test ids are used, which only ever show test ads.
 */
const TEST_REWARDED = { android: 'ca-app-pub-3940256099942544/5224354917', ios: 'ca-app-pub-3940256099942544/1712485313' };

function platform(): 'ios' | 'android' {
  const p = (globalThis as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return p === 'ios' ? 'ios' : 'android';
}

export function admobAdPort(): AdPort | null {
  if (!isNativeApp()) return null;
  const os = platform();
  const configured = os === 'ios' ? import.meta.env.VITE_ADMOB_REWARDED_IOS : import.meta.env.VITE_ADMOB_REWARDED_ANDROID;
  const adId = configured || TEST_REWARDED[os];
  const isTesting = !configured;
  const mod = import('@capacitor-community/admob');
  return {
    kind: 'ads',
    async start() {
      const { AdMob, AdmobConsentStatus } = await mod;
      await AdMob.initialize({ initializeForTesting: isTesting });
      // privacy: Google's consent form where required (EEA / UK), and Apple's tracking prompt
      const consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) await AdMob.showConsentForm();
      if (os === 'ios') {
        const { status } = await AdMob.trackingAuthorizationStatus();
        if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
      }
    },
    async showRewarded() {
      const { AdMob, RewardAdPluginEvents } = await mod;
      await AdMob.prepareRewardVideoAd({ adId, isTesting });
      let rewarded = false;
      const handle = await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
        rewarded = true;
      });
      try {
        const item = await AdMob.showRewardVideoAd();
        if (item && item.amount > 0) rewarded = true;
      } finally {
        await handle.remove();
      }
      return rewarded;
    },
  };
}
