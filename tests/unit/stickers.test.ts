import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { GACHA_RATES, MEDALS, STICKERS, drawSticker, withSticker } from '../../src/core/stickers';
import { TOTAL_MAX } from '../../src/core/stats';
import { FakeClock, HOUR_MS, T0, makeHarness } from '../helpers';

const base = { hp: 190, stamina: 180, strength: 30, defense: 25, speed: 25, luck: 20 };

describe('stickers', () => {
  it('50 kinds; ★1 is look only, ★2/★3 raise one stat a little, ★4 raises two', () => {
    expect(STICKERS).toHaveLength(50);
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(50);
    expect(new Set(STICKERS.map((s) => s.icon)).size).toBe(50);
    for (const s of STICKERS) {
      const keys = Object.keys(s.bonus);
      const core = ['strength', 'defense', 'speed', 'luck'].reduce((n, k) => n + ((s.bonus as Record<string, number>)[k] ?? 0), 0);
      if (s.rarity === 1) expect(keys).toHaveLength(0);
      if (s.rarity === 2) expect(keys).toHaveLength(1);
      if (s.rarity === 3) expect(keys).toHaveLength(1);
      if (s.rarity === 4) expect(keys).toHaveLength(2);
      expect(core).toBeLessThanOrEqual(5); // never extreme
    }
  });

  it('adds the bonus, but the ability total stays within 150 and HP within 200', () => {
    expect(withSticker(base, 'star')).toEqual(base);
    expect(withSticker(base, 'flame').strength).toBe(32);
    const crown = withSticker(base, 'crown');
    expect(crown.strength).toBe(33);
    expect(crown.defense).toBe(27);
    const full = { ...base, hp: 198, strength: 60, defense: 40, speed: 30, luck: 19 }; // total 149
    const s = withSticker(full, 'crown');
    expect(s.strength + s.defense + s.speed + s.luck).toBe(TOTAL_MAX);
    expect(withSticker(full, 'muscle').hp).toBe(200);
    expect(withSticker(base, 'nope')).toEqual(base);
  });

  it('the gacha follows the stated odds', () => {
    const r = new Rng(123);
    const n = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<number, number>;
    const N = 20000;
    for (let i = 0; i < N; i++) n[drawSticker(r).rarity]++;
    for (const k of [1, 2, 3, 4] as const) expect(Math.abs(n[k] / N - GACHA_RATES[k])).toBeLessThan(0.012);
  });
});

describe('medals, gacha and stickers (controller)', () => {
  it('wild wins give a medal, up to 10 a day; ranked gives 3 for a win and 1 otherwise', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    let got = 0;
    for (let i = 0; i < 14; i++) got += await h.controller.rewardMedals('wild', 'win');
    expect(got).toBe(MEDALS.wildDailyCap);
    expect(await h.controller.rewardMedals('wild', 'loss')).toBe(0);
    expect(await h.controller.rewardMedals('ranked', 'win')).toBe(3);
    expect(await h.controller.rewardMedals('ranked', 'loss')).toBe(1);
    expect(h.controller.getState().medals).toBe(14);
    clock.advance(24 * HOUR_MS);
    expect(await h.controller.rewardMedals('wild', 'win')).toBe(1);
  });

  it('pulling spends medals and adds stickers; not enough medals changes nothing', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    for (let i = 0; i < 4; i++) await h.controller.rewardMedals('ranked', 'win'); // 12
    await expect(h.controller.pullGacha(10)).rejects.toThrow('メダルが足りません');
    const [s] = await h.controller.pullGacha(1);
    expect(h.controller.getState().medals).toBe(2);
    expect(h.controller.getState().stickers[s.id]).toBe(1);
    expect(h.controller.getState().stickersSeen).toContain(s.id);
    await expect(h.controller.pullGacha(1)).rejects.toThrow('メダルが足りません');
    const again = await makeHarness({ clock: new FakeClock(T0), factory: h.factory, storage: h.storage });
    expect(again.controller.getState().stickers[s.id]).toBe(1);
  });

  it('one sticker per creature: swapping returns the old one; it shows in the stats; reset gives it back', async () => {
    const h = await makeHarness({ clock: new FakeClock(T0) });
    await h.controller.startNewGame();
    for (let i = 0; i < 40; i++) await h.controller.rewardMedals('ranked', 'win');
    await h.controller.pullGacha(10);
    const stock = { ...h.controller.getState().stickers };
    const ids = Object.keys(stock);
    const gid = h.controller.getState().game!.gameId;
    const plain = h.controller.currentStats()!;
    await h.controller.putSticker(gid, ids[0]);
    expect(h.controller.getState().game!.sticker).toBe(ids[0]);
    expect(h.controller.getState().stickers[ids[0]] ?? 0).toBe(stock[ids[0]] - 1);
    expect(h.controller.currentStats()).toEqual(withSticker(plain, ids[0]));
    if (ids[1]) {
      await h.controller.putSticker(gid, ids[1]);
      expect(h.controller.getState().stickers[ids[0]]).toBe(stock[ids[0]]); // the old one came back
    }
    const missing = STICKERS.find((x) => !stock[x.id])!;
    await expect(h.controller.putSticker(gid, missing.id)).rejects.toThrow('そのシールを持っていません');
    await h.controller.resetGame();
    expect((await h.repo.getMedalsAndStickers()).stickers).toEqual(stock); // nothing lost
  });
});
