import { describe, expect, it } from 'vitest';
import { COMPLETE_GROWTH_INDEX, DAY_MS } from '../../src/core/constants';
import { BOOST_RATE, activeBoost, boostAccrued, dueIndexAt, slotDueAt } from '../../src/core/schedule';
import { BOOSTS, COIN_PACKS } from '../../src/core/shop';
import { dueGrowthIndex, growthTime } from '../../src/core/time';
import { completionNoticeAt } from '../../src/core/notice';
import { testPurchasePort, type PurchasePort, type StorePurchase } from '../../src/engine/purchases';
import { FakeClock, HOUR_MS, T0, makeHarness } from '../helpers';

const base = { startedAt: T0 };

describe('growth schedule with pace-ups', () => {
  it('without pace-ups it is exactly the old schedule', () => {
    const g = { ...base, timeBonusMs: 37 * 60_000 };
    for (const t of [T0 - 5, T0, T0 + 59 * 60_000, T0 + 5 * HOUR_MS + 3, T0 + 30 * DAY_MS]) {
      expect(dueIndexAt(g, t)).toBe(dueGrowthIndex(T0 - g.timeBonusMs, t));
    }
    for (const i of [0, 1, 17, 720]) expect(slotDueAt(g, i)).toBe(growthTime(T0 - g.timeBonusMs, i));
  });

  it('a 1-day pace-up adds no dot when used, then 24 extra dots arrive within 24/RATE hours', () => {
    const at = T0 + 10 * HOUR_MS + 30 * 60_000;
    const g = { ...base, boosts: [{ boostId: 'boost1', at, ms: DAY_MS }] };
    expect(dueIndexAt(g, at)).toBe(10); // nothing added on the spot
    const end = at + DAY_MS / (BOOST_RATE - 1);
    expect(boostAccrued(g, end)).toBe(DAY_MS);
    expect(dueIndexAt(g, end)).toBe(dueIndexAt(base, end) + 24);
    // afterwards, one dot an hour again, a day ahead
    expect(dueIndexAt(g, end + 5 * HOUR_MS)).toBe(dueIndexAt(base, end + 5 * HOUR_MS) + 24);
    // during it, a dot every 1/RATE hour
    const s11 = slotDueAt(g, 11), s12 = slotDueAt(g, 12);
    expect(s12 - s11).toBeCloseTo(HOUR_MS / BOOST_RATE, 3);
    expect(activeBoost(g, at + 1000)?.endsAt).toBeCloseTo(end, 3);
    expect(activeBoost(g, end + 1)).toBeNull();
  });

  it('slotDueAt is the inverse of dueIndexAt, also across queued pace-ups and item bonuses', () => {
    const g = { ...base, timeBonusMs: 25 * 60_000, boosts: [{ boostId: 'boost2', at: T0 + 3 * HOUR_MS, ms: 2 * DAY_MS }, { boostId: 'boost1', at: T0 + 4 * HOUR_MS, ms: DAY_MS }] };
    let prev = -Infinity;
    for (let i = 1; i <= 200; i++) {
      const t = slotDueAt(g, i);
      expect(t).toBeGreaterThan(prev);
      prev = t;
      expect(dueIndexAt(g, Math.ceil(t) + 1)).toBeGreaterThanOrEqual(i);
      expect(dueIndexAt(g, Math.floor(t) - 1)).toBeLessThan(i);
    }
    // both run back to back: 3 days saved in 3 days / (RATE - 1)
    const end = T0 + 3 * HOUR_MS + (3 * DAY_MS) / (BOOST_RATE - 1);
    expect(boostAccrued(g, end)).toBe(3 * DAY_MS);
    expect(completionNoticeAt({ ...g, gameId: 'g', lastProcessedGrowthIndex: 0, schemaVersion: 1, generatorVersion: 3, initialSeed: 1, createdAt: T0, updatedAt: T0, lastObservedAt: T0 })).toBe(T0 + COMPLETE_GROWTH_INDEX * HOUR_MS - 25 * 60_000 - 3 * DAY_MS);
  });

  it('ten items, 1 to 10 days', () => {
    expect(BOOSTS.map((b) => b.days)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(new Set(BOOSTS.map((b) => b.id)).size).toBe(10);
  });
});

/** A store that hands purchases to the app like App Store / Google Play, including re-deliveries. */
function fakeStore() {
  let handler: ((p: StorePurchase) => Promise<void>) | null = null;
  const port: PurchasePort & { deliver(p: StorePurchase): Promise<void> } = {
    kind: 'store',
    async start(onPaid) {
      handler = onPaid;
    },
    products: () => [...COIN_PACKS],
    async buy(productId) {
      await handler!({ transactionId: `t-${productId}`, productId, quantity: 1 });
      return true;
    },
    deliver: (p) => handler!(p),
  };
  return port;
}

describe('coins and pace-up items', () => {
  it('a purchase credits coins once, even if the store delivers it again', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    const store = fakeStore();
    await h.controller.attachStore(store);
    expect(h.controller.getState().shop).toBe('store');
    await h.controller.buyCoins('coins_550');
    expect(h.controller.getState().coins).toBe(550);
    await store.deliver({ transactionId: 't-coins_550', productId: 'coins_550', quantity: 1 });
    expect(h.controller.getState().coins).toBe(550);
    expect(await h.repo.getCoins()).toBe(550);
    await store.deliver({ transactionId: 'other', productId: 'coins_100', quantity: 2 });
    expect(h.controller.getState().coins).toBe(750);
    await expect(store.deliver({ transactionId: 'x', productId: 'nope', quantity: 1 })).rejects.toThrow();
    expect(h.controller.getState().coins).toBe(750);
  });

  it('coins are exchanged for items atomically; not enough coins changes nothing', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.attachStore(testPurchasePort(COIN_PACKS));
    await h.controller.buyCoins('coins_100');
    await expect(h.controller.exchangeBoost('boost2')).rejects.toThrow('コインが足りません');
    expect(h.controller.getState().coins).toBe(100);
    await h.controller.exchangeBoost('boost1');
    expect(h.controller.getState().coins).toBe(0);
    expect(h.controller.getState().inventory.boost1).toBe(1);
    expect(await h.repo.getInventory()).toMatchObject({ boost1: 1 });
  });

  it('using a pace-up adds no dot now, speeds growth, finishes early, and is never more than what is left', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.attachStore(testPurchasePort(COIN_PACKS));
    await h.controller.startNewGame();
    await h.controller.buyCoins('coins_2600');
    await h.controller.exchangeBoost('boost10');
    await h.controller.exchangeBoost('boost10');
    await h.controller.exchangeBoost('boost10');
    await h.controller.exchangeBoost('boost1');
    clock.advance(2 * HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(3);
    const r = await h.controller.useBoost('boost10');
    expect(r.ms).toBe(10 * DAY_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(3); // nothing on the spot
    expect(h.controller.getState().inventory.boost10).toBe(2);
    clock.advance(HOUR_MS);
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBe(3 + BOOST_RATE);
    await h.controller.useBoost('boost10');
    // 2 h used, 20 days queued: only 30 d - 2 h - 20 d is left, so the third item is cut to that
    const third = await h.controller.useBoost('boost10');
    expect(third.ms).toBeLessThanOrEqual(10 * DAY_MS - 2 * HOUR_MS);
    expect(third.ms).toBeGreaterThan(9 * DAY_MS);
    await expect(h.controller.useBoost('boost1')).rejects.toThrow('これ以上は短くできません');
    expect(h.controller.getState().inventory.boost1).toBe(1); // not used up
    // everything runs: complete after (30 days - 3 h) / (RATE - 1) or so, far sooner than 30 days
    clock.advance(Math.ceil((30 * DAY_MS) / (BOOST_RATE - 1)));
    await h.controller.checkGrowth();
    expect(h.controller.getState().pixelCount).toBeGreaterThanOrEqual(COMPLETE_GROWTH_INDEX + 1);
    expect(h.controller.getState().completion).toBe('complete');
    // reload reproduces the same dots
    const ids = h.controller.pixels.map((p) => `${p.x},${p.y}${p.color}`).join('|');
    const again = await makeHarness({ clock, factory: h.factory, storage: h.storage });
    expect(again.controller.pixels.map((p) => `${p.x},${p.y}${p.color}`).join('|')).toBe(ids);
  });

  it('reset and loading a save never take away bought coins', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.attachStore(testPurchasePort(COIN_PACKS));
    await h.controller.startNewGame();
    await h.controller.buyCoins('coins_1200');
    const text = await h.controller.exportSaveText();
    await h.controller.resetGame();
    expect(await h.repo.getCoins()).toBe(1200);
    await h.controller.importSaveText(text);
    expect(await h.repo.getCoins()).toBe(1200);
    expect(h.controller.getState().coins).toBe(1200);
  });
});
