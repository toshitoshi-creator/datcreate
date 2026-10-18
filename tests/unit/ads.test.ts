import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_DAILY_LIMIT, AD_REWARD_COINS } from '../../src/core/shop';
import type { AdPort } from '../../src/engine/ads';
import { FakeClock, HOUR_MS, T0, makeHarness } from '../helpers';

function fakeAds(results: (boolean | Error)[]) {
  const port: AdPort & { shown: number } = {
    kind: 'ads',
    shown: 0,
    async start() {},
    async showRewarded() {
      const r = results[port.shown++ % results.length];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return port;
}

describe('rewarded ads', () => {
  it('a watched ad gives coins, up to the daily limit, and the limit resets the next day', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    const ads = fakeAds([true]);
    await h.controller.attachAds(ads);
    expect(h.controller.getState().ads).toBe('ads');
    expect(h.controller.getState().adsLeftToday).toBe(AD_DAILY_LIMIT);
    for (let i = 0; i < AD_DAILY_LIMIT; i++) expect(await h.controller.watchAdForCoins()).toBe(AD_REWARD_COINS);
    expect(h.controller.getState().coins).toBe(AD_REWARD_COINS * AD_DAILY_LIMIT);
    expect(h.controller.getState().adsLeftToday).toBe(0);
    await expect(h.controller.watchAdForCoins()).rejects.toThrow('また明日');
    expect(ads.shown).toBe(AD_DAILY_LIMIT); // no ad is shown past the limit
    clock.advance(24 * HOUR_MS);
    expect(await h.controller.watchAdForCoins()).toBe(AD_REWARD_COINS);
    expect(await h.repo.getCoins()).toBe(AD_REWARD_COINS * (AD_DAILY_LIMIT + 1));
    // the count survives a restart
    const again = await makeHarness({ clock, factory: h.factory, storage: h.storage });
    await again.controller.attachAds(fakeAds([true]));
    expect(again.controller.getState().adsLeftToday).toBe(AD_DAILY_LIMIT - 1);
  });

  it('closing the ad early gives nothing and does not use up a turn; a load error changes nothing', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.attachAds(fakeAds([false, new Error('no fill')]));
    expect(await h.controller.watchAdForCoins()).toBe(0);
    await expect(h.controller.watchAdForCoins()).rejects.toThrow('読みこめません');
    expect(h.controller.getState().coins).toBe(0);
    expect(h.controller.getState().adsLeftToday).toBe(AD_DAILY_LIMIT);
  });

  it('without an ad provider (the web build) it says so', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    expect(h.controller.getState().ads).toBe('none');
    await expect(h.controller.watchAdForCoins()).rejects.toThrow('アプリ版');
  });
});

// ---- the AdMob wrapper, with the plugin replaced ---------------------------------

const calls: string[] = [];
let reward: { type: string; amount: number } | null = { type: 'coins', amount: 1 };
let rewardEvent = false;
vi.mock('@capacitor-community/admob', () => ({
  AdmobConsentStatus: { REQUIRED: 'REQUIRED' },
  RewardAdPluginEvents: { Rewarded: 'onRewardedVideoAdReward' },
  AdMob: {
    initialize: async (o: unknown) => void calls.push(`init:${JSON.stringify(o)}`),
    requestConsentInfo: async () => ({ status: 'NOT_REQUIRED', isConsentFormAvailable: false, canRequestAds: true }),
    showConsentForm: async () => void calls.push('consent'),
    trackingAuthorizationStatus: async () => ({ status: 'notDetermined' }),
    requestTrackingAuthorization: async () => void calls.push('att'),
    prepareRewardVideoAd: async (o: { adId: string; isTesting: boolean }) => void calls.push(`prepare:${o.adId}:${o.isTesting}`),
    addListener: async (_e: string, fn: () => void) => {
      if (rewardEvent) fn();
      return { remove: async () => void calls.push('removed') };
    },
    showRewardVideoAd: async () => reward,
  },
}));

import { admobAdPort } from '../../src/services/admobAds';

const g = globalThis as { Capacitor?: unknown };
afterEach(() => {
  delete g.Capacitor;
  calls.length = 0;
});

describe('AdMob port', () => {
  it('is absent on the web', () => {
    expect(admobAdPort()).toBeNull();
  });

  it('uses Google test ads when no ad unit is configured, asks tracking permission on iOS, and reports the reward', async () => {
    g.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const port = admobAdPort()!;
    await port.start();
    expect(calls).toContain('init:{"initializeForTesting":true}');
    expect(calls).toContain('att');
    expect(await port.showRewarded()).toBe(true);
    expect(calls).toContain('prepare:ca-app-pub-3940256099942544/1712485313:true');
    expect(calls.at(-1)).toBe('removed');
    reward = { type: '', amount: 0 };
    expect(await port.showRewarded()).toBe(false);
    rewardEvent = true;
    expect(await port.showRewarded()).toBe(true);
  });
});
