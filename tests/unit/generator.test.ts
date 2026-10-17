import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEX_COLOR_RE, hexToHsl } from '../../src/core/color';
import { Simulation } from '../../src/core/generator';
import type { Pixel } from '../../src/core/types';
import { HOUR_MS, T0, envAt, grow } from '../helpers';

const SEEDS = [1, 7, 42, 1234, 99991, 2654435761, 3816266512];

function assertHealthy(pixels: Pixel[]) {
  const cells = new Set<string>();
  pixels.forEach((p, i) => {
    expect(p.growthIndex).toBe(i);
    expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
    expect(p.color).toMatch(HEX_COLOR_RE);
    const k = `${p.x},${p.y}`;
    expect(cells.has(k)).toBe(false);
    cells.add(k);
  });
}

describe('generator', () => {
  it('starts with exactly one dot at the origin', () => {
    const { pixels } = grow(5, 1);
    expect(pixels).toHaveLength(1);
    expect(pixels[0]).toMatchObject({ x: 0, y: 0, growthIndex: 0, parentId: null });
  });

  it('same seed and inputs give identical results', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const a = grow(seed, 400).pixels;
      const b = grow(seed, 400).pixels;
      expect(b).toEqual(a);
    }
  });

  it('different seeds give different individuals', () => {
    const a = grow(1, 200).pixels.map((p) => `${p.x},${p.y},${p.color}`);
    const b = grow(2, 200).pixels.map((p) => `${p.x},${p.y},${p.color}`);
    expect(a).not.toEqual(b);
  });

  it('resuming from stored pixels continues exactly like an uninterrupted run (restart safety)', () => {
    const full = grow(42, 900).pixels;
    for (const cut of [1, 8, 9, 63, 64, 65, 200, 333, 512, 777]) {
      const sim = new Simulation({ gameId: 'test', initialSeed: 42, generatorVersion: 1 }, full.slice(0, cut));
      for (let i = cut; i < 900; i++) {
        const p = sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt((9 + i) % 24), environmentSnapshotId: null }).pixel;
        expect(p).toEqual(full[i]);
      }
    }
  });

  it('never places two dots on the same cell and never skips an index (10,000 dots)', () => {
    const t = performance.now();
    const { pixels } = grow(2654435761, 10_000);
    const ms = performance.now() - t;
    expect(pixels).toHaveLength(10_000);
    assertHealthy(pixels);
    console.info(`[perf] generated 10,000 dots in ${ms.toFixed(0)} ms`);
  });

  it('face / limb bias never changes existing dots', () => {
    const { sim, pixels } = grow(1234, 300);
    const frozen = pixels.map((p) => Object.freeze({ ...p, envUsed: Object.freeze({ ...p.envUsed }) }));
    const before = JSON.stringify(frozen);
    const snapshot = [...sim.model.list].map((c) => ({ ...c }));
    for (let i = 300; i < 800; i++) {
      sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt(12, 'unknown', 1), environmentSnapshotId: null });
    }
    expect(JSON.stringify(frozen)).toBe(before);
    snapshot.forEach((c, i) => expect(sim.model.list[i]).toEqual(c));
    // and a simulation built from frozen (immutable) pixels works without mutating them
    const replay = new Simulation({ gameId: 'test', initialSeed: 1234, generatorVersion: 1 }, frozen as Pixel[]);
    expect(() => replay.generateNext({ createdAt: 0, env: envAt(1, 'snow', 1), environmentSnapshotId: null })).not.toThrow();
  });

  it('does not require faces: some individuals stay abstract, and growth works with bias 0', () => {
    let withoutPlan = 0;
    let withPlan = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { sim } = grow(seed * 7919, 400);
      if (sim.plans.length === 0) withoutPlan++;
      else withPlan++;
    }
    expect(withoutPlan).toBeGreaterThan(0); // faces are not forced on everyone
    expect(withPlan).toBeGreaterThan(0); // but they are possible
    const { pixels } = grow(77, 600, (i) => envAt(i % 24, 'unknown', 0));
    assertHealthy(pixels);
  });

  it('weather shifts the colour distribution without dictating it', () => {
    const blueShare = (weather: 'rain' | 'clear') => {
      let blue = 0, total = 0;
      for (const seed of SEEDS) {
        for (const p of grow(seed, 250, (i) => envAt((9 + i) % 24, weather, 0.6, 1)).pixels) {
          const { h } = hexToHsl(p.color);
          if (h >= 190 && h <= 245) blue++;
          total++;
        }
      }
      return blue / total;
    };
    const rain = blueShare('rain');
    const clear = blueShare('clear');
    expect(rain).toBeGreaterThan(clear);
    expect(rain).toBeLessThan(0.9); // rain does not paint everything blue
  });

  it('time of day changes generated colours', () => {
    const night = grow(9, 200, () => envAt(23, 'unknown', 0.6, 1)).pixels;
    const day = grow(9, 200, () => envAt(12, 'unknown', 0.6, 1)).pixels;
    const meanL = (ps: Pixel[]) => ps.reduce((s, p) => s + hexToHsl(p.color).l, 0) / ps.length;
    expect(meanL(night)).toBeLessThan(meanL(day));
  });

  it('individuals differ in shape (not all the same blob)', () => {
    const sigs = new Set<string>();
    for (const seed of SEEDS) {
      const { sim } = grow(seed, 500);
      const m = sim.model;
      sigs.add(`${m.maxX - m.minX}x${m.maxY - m.minY}`);
    }
    expect(sigs.size).toBeGreaterThan(3);
  });
});

describe('no fixed character art', () => {
  it('ships no image assets or image loading in source', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = walk(join(__dirname, '../../src'));
    expect(files.filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f))).toEqual([]);
    for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f))) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/new Image\(|\.(png|jpe?g|gif|webp)['"]/);
    }
  });
});
