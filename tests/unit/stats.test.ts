import { describe, expect, it } from 'vitest';
import { simulateBattle, type Fighter } from '../../src/core/battle';
import { hslToHex } from '../../src/core/color';
import { resolveStyle } from '../../src/core/looks';
import { apportion, statsFromColors } from '../../src/core/stats';
import { growWildDot } from '../../src/core/wild';
import { grow } from '../helpers';

const solid = (h: number, n = 721, s = 0.7, l = 0.55) => Array.from({ length: n }, () => hslToHex({ h, s, l }));

describe('stats from dot colours', () => {
  it('four core stats always add up to exactly 100; HP / stamina stay within 200', () => {
    for (let k = 1; k <= 40; k++) {
      const look = resolveStyle('random', k * 131);
      for (const n of [1, 10, 200, 721]) {
        const s = statsFromColors(grow(k * 131, n, undefined, 3, look.style, look.species).pixels.map((p) => p.color));
        expect(s.strength + s.defense + s.speed + s.luck).toBe(100);
        for (const v of [s.strength, s.defense, s.speed, s.luck]) expect(v).toBeGreaterThanOrEqual(4);
        expect(s.hp).toBeGreaterThanOrEqual(10);
        expect(s.hp).toBeLessThanOrEqual(200);
        expect(s.stamina).toBeLessThanOrEqual(200);
      }
    }
  });

  it('colour decides the leaning: red -> strength, green -> speed, blue -> defense, purple -> luck', () => {
    const red = statsFromColors(solid(10)), green = statsFromColors(solid(100)), blue = statsFromColors(solid(225)), purple = statsFromColors(solid(295));
    const top = (s: ReturnType<typeof statsFromColors>) => (['strength', 'defense', 'speed', 'luck'] as const).reduce((a, b) => (s[a] >= s[b] ? a : b));
    expect(top(red)).toBe('strength');
    expect(top(green)).toBe('speed');
    expect(top(blue)).toBe('defense');
    expect(top(purple)).toBe('luck');
    expect(red.hp).toBe(200); // warm, full-grown
    expect(blue.stamina).toBe(200); // cool, full-grown
    expect(red.hp).toBeGreaterThan(red.stamina);
    expect(blue.stamina).toBeGreaterThan(blue.hp);
  });

  it('is deterministic and grows with the body', () => {
    const { pixels } = grow(42, 721, undefined, 3);
    const colors = pixels.map((p) => p.color);
    expect(statsFromColors(colors)).toEqual(statsFromColors([...colors]));
    expect(statsFromColors(colors.slice(0, 100)).hp).toBeLessThan(statsFromColors(colors).hp);
  });

  it('apportion keeps the total exact', () => {
    expect(apportion([1, 1, 1], 100).reduce((a, b) => a + b, 0)).toBe(100);
    expect(apportion([0, 0, 0, 0], 100, 4).reduce((a, b) => a + b, 0)).toBe(100);
    expect(apportion([5, 1, 0.1, 3], 100, 4).every((v) => v >= 4)).toBe(true);
  });
});

describe('battle', () => {
  const f = (name: string, h: number): Fighter => ({ name, stats: statsFromColors(solid(h)) });

  it('is deterministic for a seed and always ends', () => {
    const a = f('A', 10), b = f('B', 225);
    expect(simulateBattle(a, b, 7)).toEqual(simulateBattle(a, b, 7));
    for (let seed = 0; seed < 200; seed++) {
      const r = simulateBattle(a, b, seed);
      expect(['a', 'b', 'draw']).toContain(r.winner);
      expect(r.events.length).toBeGreaterThan(0);
      const lastEv = r.events[r.events.length - 1];
      expect(['ko', 'timeup']).toContain(lastEv.kind);
      for (const e of r.events) {
        expect(e.hp.a).toBeGreaterThanOrEqual(0);
        expect(e.hp.b).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a grown-up creature usually beats a tiny one', () => {
    const big = { name: 'big', stats: statsFromColors(solid(30)) };
    const tiny = { name: 'tiny', stats: statsFromColors(solid(30, 60)) };
    let wins = 0;
    for (let seed = 0; seed < 100; seed++) if (simulateBattle(big, tiny, seed).winner === 'a') wins++;
    expect(wins).toBeGreaterThan(90);
  });

  it('wild dots are grown with the normal rules and are reproducible', () => {
    const a = growWildDot(123, 200), b = growWildDot(123, 200);
    expect(a).toEqual(b);
    expect(new Set(a.map((p) => `${p.x},${p.y}`)).size).toBe(200);
  });

  it('is balanced: no leading stat dominates among grown creatures', () => {
    const CORE = ['strength', 'defense', 'speed', 'luck'] as const;
    const pool = Array.from({ length: 40 }, (_, k) => statsFromColors(growWildDot((k * 2654435761 + 17) >>> 0, 721).map((p) => p.color)));
    const wins = new Array(pool.length).fill(0), games = new Array(pool.length).fill(0);
    for (let i = 0; i < pool.length; i++)
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;
        for (let s = 0; s < 4; s++) {
          const w = simulateBattle({ name: 'a', stats: pool[i] }, { name: 'b', stats: pool[j] }, i * 7919 + j * 31 + s).winner;
          games[i]++;
          games[j]++;
          if (w === 'a') wins[i]++;
          else if (w === 'b') wins[j]++;
          else { wins[i] += 0.5; wins[j] += 0.5; }
        }
      }
    const rate = wins.map((w, i) => w / games[i]);
    const lead = (s: (typeof pool)[number]) => CORE.reduce((a, b) => (s[a] >= s[b] ? a : b));
    for (const k of CORE) {
      const r = rate.filter((_, i) => lead(pool[i]) === k);
      if (r.length < 3) continue;
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      expect(mean, k).toBeGreaterThan(0.4);
      expect(mean, k).toBeLessThan(0.6);
    }
    // nobody is hopeless or unbeatable
    expect(Math.min(...rate)).toBeGreaterThan(0.2);
    expect(Math.max(...rate)).toBeLessThan(0.8);
  });
});
