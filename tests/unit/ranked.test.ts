import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/core/constants';
import { RANKED_DAILY_LIMIT, START_RATING, TIERS, applyResult, freshRecord, makeRival, nextTier, powerOf, rollRecord, seasonOf, softReset, tierOf } from '../../src/core/ranked';
import { FakeClock, HOUR_MS, T0, makeHarness } from '../helpers';

describe('rank points and seasons', () => {
  it('tiers, points and the no-demotion floor', () => {
    expect(tierOf(START_RATING).id).toBe('bronze');
    expect(tierOf(1100).id).toBe('silver');
    expect(tierOf(9999).id).toBe('diamond');
    expect(nextTier(1090)).toEqual({ tier: TIERS[1], need: 10 });
    expect(nextTier(2000)).toBeNull();
    expect(applyResult(1000, 'win')).toBe(1020);
    expect(applyResult(1000, 'loss')).toBe(1000); // never below the start
    expect(applyResult(1110, 'loss')).toBe(1100); // never below silver once there
    expect(applyResult(1130, 'loss')).toBe(1115);
    expect(applyResult(1095, 'draw')).toBe(1100);
  });

  it('a new season pays the best rank once and starts one rank lower', () => {
    const rec = { ...freshRecord('2026-01', 'd1'), rating: 1420, best: 1460, wins: 30, losses: 20 };
    const r = rollRecord(rec, '2026-02', 'd2');
    expect(r.reward?.season).toBe('2026-01');
    expect(r.reward?.tier.id).toBe('platinum');
    expect(r.rec.rating).toBe(softReset(1420));
    expect(r.rec.rating).toBe(1250);
    expect(r.rec.wins).toBe(0);
    expect(rollRecord(r.rec, '2026-02', 'd2').reward).toBeNull();
    // a season with no battles gives nothing
    expect(rollRecord(freshRecord('2026-03', 'd'), '2026-04', 'd').reward).toBeNull();
    expect(seasonOf(new Date(2026, 9, 18).getTime())).toBe('2026-10');
  });

  it('rivals are reproducible and get stronger with points', () => {
    const a = makeRival(42, 1000), b = makeRival(42, 1000);
    expect(a.stats).toEqual(b.stats);
    expect(a.name).toMatch(/^ライバル・/);
    // same candidates, picked from opposite ends
    for (const seed of [7, 8, 9]) {
      const weak = makeRival(seed, START_RATING), strong = makeRival(seed, START_RATING + 800);
      expect(powerOf(strong.stats)).toBeGreaterThan(powerOf(weak.stats));
    }
  });
});

describe('practice ranked battles (controller)', () => {
  async function withChampion() {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(30 * DAY_MS);
    await h.controller.checkGrowth();
    await h.controller.retireToCollection('ちゃんぴ');
    const [g] = await h.controller.listCollection();
    return { h, clock, g };
  }

  it('only a finished creature in the collection can be the representative', async () => {
    const { h, g } = await withChampion();
    await expect(h.controller.setChampion('nope')).rejects.toThrow('完成した子');
    await h.controller.setChampion(g.gameId);
    expect((await h.controller.rankedStatus()).champion?.gameId).toBe(g.gameId);
    // deleting it from the collection clears the representative
    await h.controller.deleteFromCollection(g.gameId);
    expect((await h.controller.rankedStatus()).champion).toBeNull();
  });

  it('plays, saves the result before showing it, fixes the rival, and stops at the daily limit', async () => {
    const { h, clock, g } = await withChampion();
    await h.controller.setChampion(g.gameId);
    const pixels = await h.controller.loadCollectionPixels(g.gameId);
    const { statsFromColors } = await import('../../src/core/stats');
    const stats = statsFromColors(pixels.map((p) => p.color));
    let { rec } = await h.controller.rankedStatus();
    expect(rec.rating).toBe(START_RATING);
    // the same rival comes back when looking again
    expect(h.controller.rivalFor(rec, g.gameId).stats).toEqual(h.controller.rivalFor(rec, g.gameId).stats);
    for (let i = 0; i < RANKED_DAILY_LIMIT; i++) {
      const rival = h.controller.rivalFor(rec, g.gameId);
      const r = await h.controller.playRanked(stats, 'ちゃんぴ', rival, rec, g.gameId);
      expect(r.rec.played).toBe(i + 1);
      expect(r.after).toBe(applyResult(r.before, r.battle.winner === 'a' ? 'win' : r.battle.winner === 'b' ? 'loss' : 'draw'));
      // a stale screen cannot replay the same battle
      await expect(h.controller.playRanked(stats, 'ちゃんぴ', rival, rec, g.gameId)).rejects.toThrow();
      rec = r.rec;
    }
    expect(rec.wins + rec.losses + rec.draws).toBe(RANKED_DAILY_LIMIT);
    expect(rec.history).toHaveLength(RANKED_DAILY_LIMIT);
    await expect(h.controller.playRanked(stats, 'ちゃんぴ', h.controller.rivalFor(rec, g.gameId), rec, g.gameId)).rejects.toThrow('おしまい');
    // saved: a restart sees the same record
    const again = await makeHarness({ clock, factory: h.factory, storage: h.storage });
    expect((await again.controller.rankedStatus()).rec.rating).toBe(rec.rating);
    // next day: new battles allowed
    clock.advance(24 * HOUR_MS);
    expect((await h.controller.rankedStatus()).rec.played).toBe(0);
  });

  it('the season reward is paid once, into the wallet', async () => {
    const { h, clock, g } = await withChampion();
    await h.controller.setChampion(g.gameId);
    const pixels = await h.controller.loadCollectionPixels(g.gameId);
    const { statsFromColors } = await import('../../src/core/stats');
    const stats = statsFromColors(pixels.map((p) => p.color));
    const { rec } = await h.controller.rankedStatus();
    await h.controller.playRanked(stats, 'x', h.controller.rivalFor(rec, g.gameId), rec, g.gameId);
    clock.advance(40 * DAY_MS); // into a later month
    const coins = h.controller.getState().coins;
    const s = await h.controller.rankedStatus();
    expect(s.seasonReward?.tier.seasonCoins).toBeGreaterThan(0);
    expect(h.controller.getState().coins).toBe(coins + s.seasonReward!.tier.seasonCoins);
    expect(await h.repo.getCoins()).toBe(coins + s.seasonReward!.tier.seasonCoins);
    expect((await h.controller.rankedStatus()).seasonReward).toBeNull();
  });
});
