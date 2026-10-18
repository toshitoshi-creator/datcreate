import { DAY_MS } from './constants';

/**
 * Coins are bought with real money (App Store / Google Play in the app) and
 * exchanged for pace-up items. Prices here are placeholders shown until the
 * store reports the real, localised price set in its console.
 */
export interface CoinPack {
  productId: string;
  coins: number;
  price: string;
}

export const COIN_PACKS: readonly CoinPack[] = [
  { productId: 'coins_100', coins: 100, price: '¥160' },
  { productId: 'coins_550', coins: 550, price: '¥800' },
  { productId: 'coins_1200', coins: 1200, price: '¥1,600' },
  { productId: 'coins_2600', coins: 2600, price: '¥3,200' },
];

export const COIN_PACK_BY_ID: ReadonlyMap<string, CoinPack> = new Map(COIN_PACKS.map((p) => [p.productId, p]));

/** Pace-up items: each saves `days` of growth (24 dots a day), sped up rather than added at once. */
export interface BoostDef {
  id: string;
  name: string;
  icon: string;
  days: number;
  cost: number;
}

export const BOOSTS: readonly BoostDef[] = [
  { id: 'boost1', name: 'そだつしずく', icon: '💧', days: 1, cost: 100 },
  { id: 'boost2', name: 'ふたばの芽', icon: '🌱', days: 2, cost: 190 },
  { id: 'boost3', name: 'よつばのクローバー', icon: '🍀', days: 3, cost: 270 },
  { id: 'boost4', name: 'チューリップ', icon: '🌷', days: 4, cost: 350 },
  { id: 'boost5', name: 'おつきさま', icon: '🌙', days: 5, cost: 420 },
  { id: 'boost6', name: 'ながれぼし', icon: '🌠', days: 6, cost: 500 },
  { id: 'boost7', name: 'にじのかけら', icon: '🌈', days: 7, cost: 560 },
  { id: 'boost8', name: 'ふしぎな水晶', icon: '🔮', days: 8, cost: 640 },
  { id: 'boost9', name: 'ちいさな王冠', icon: '👑', days: 9, cost: 700 },
  { id: 'boost10', name: 'ときのほうせき', icon: '💎', days: 10, cost: 750 },
];

export const BOOST_BY_ID: ReadonlyMap<string, BoostDef> = new Map(BOOSTS.map((b) => [b.id, b]));

export const boostMs = (b: BoostDef) => b.days * DAY_MS;

/** Watching a rewarded ad (in the app) gives a few coins, a limited number of times a day. */
export const AD_REWARD_COINS = 10;
export const AD_DAILY_LIMIT = 5;

/** Local calendar day key used for daily limits. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
