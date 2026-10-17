import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeShape } from '../../src/core/analysis';
import { Simulation } from '../../src/core/generator';
import { HOUR_MS, T0, envAt, grow } from '../helpers';

const fp = (seed: number, version: number) =>
  createHash('sha256')
    .update(grow(seed, 900, undefined, version).pixels.map((p) => `${p.x},${p.y},${p.color}`).join('|'))
    .digest('hex')
    .slice(0, 16);

describe('generator versions', () => {
  it('generator v1 output is frozen (games started on v1 keep growing identically)', () => {
    expect([42, 7919, 2654435761].map((s) => fp(s, 1))).toEqual(['6069a8f449cf112a', '162417509178cc79', '561d68b35ead94ea']);
  });
  it('generator v3 output is frozen', () => {
    expect([42, 7919, 2654435761].map((s) => fp(s, 3))).toEqual(['f417e43eb7cb7572', '6add349ff9fd8c4a', 'ed38c8c47c818dbf']);
  });
  it('generator v2 output is frozen', () => {
    expect([42, 7919, 2654435761].map((s) => fp(s, 2))).toEqual(['0642f212cd39c397', '8a20612fc6790780', 'bb792119a6e5ad57']);
  });
});

describe('generator v2 (character-oriented)', () => {
  const v2 = (seed: number, n: number, bias = 0.6) => grow(seed, n, (i) => envAt((9 + i) % 24, 'unknown', bias), 2);

  it('is deterministic and resumes identically after a restart', () => {
    const full = v2(42, 700).pixels;
    expect(v2(42, 700).pixels).toEqual(full);
    for (const cut of [1, 33, 120, 401]) {
      const sim = new Simulation({ gameId: 'test', initialSeed: 42, generatorVersion: 2 }, full.slice(0, cut));
      for (let i = cut; i < 700; i++) {
        expect(sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt((9 + i) % 24), environmentSnapshotId: null }).pixel).toEqual(full[i]);
      }
    }
  });

  it('never stacks dots and records its version on every dot', () => {
    const { pixels } = v2(2654435761, 5000);
    expect(new Set(pixels.map((p) => `${p.x},${p.y}`)).size).toBe(5000);
    expect(pixels.every((p, i) => p.growthIndex === i && p.generatorVersion === 2)).toBe(true);
  });

  it('forms face-like gaps more often than v1, yet some individuals stay abstract', () => {
    const faces = (version: number) => {
      let withFace = 0, abstract = 0;
      for (let k = 1; k <= 30; k++) {
        const { sim } = grow(k * 7919, 720, undefined, version);
        const plan = sim.plans.at(-1);
        if (!plan) { abstract++; continue; }
        // same yardstick for both versions: newest plan only, >=2 realised eyes of readable size
        const a = analyzeShape(sim.model.list, sim.model.size, sim.genome, [plan], sim.tuning);
        if ((a.face?.eyesFromHoles ?? 0) >= 2 && plan.eyes.filter((e) => e.r >= 1).length >= 2) withFace++;
      }
      return { withFace, abstract };
    };
    const one = faces(1), two = faces(2);
    console.info(`[character] individuals with >=2 readable eye-like gaps at 720 dots: v1 ${one.withFace}/30, v2 ${two.withFace}/30; no face plan: v2 ${two.abstract}/30`);
    expect(two.withFace).toBeGreaterThan(one.withFace);
    expect(two.abstract).toBeGreaterThan(0); // faces are encouraged, never forced on everyone
  });

  it('face bias never alters existing dots, and bias 0 still grows normally', () => {
    const { sim, pixels } = v2(1234, 300);
    const before = JSON.stringify(pixels);
    for (let i = 300; i < 700; i++) sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt(12, 'unknown', 1), environmentSnapshotId: null });
    expect(JSON.stringify(pixels)).toBe(before);
    const flat = v2(77, 600, 0).pixels;
    expect(new Set(flat.map((p) => `${p.x},${p.y}`)).size).toBe(600);
  });
});

describe('generator v3 (kawaii)', () => {
  const v3 = (seed: number, n: number, bias = 0.6) => grow(seed, n, (i) => envAt((9 + i) % 24, 'unknown', bias), 3);

  it('is deterministic and resumes identically after a restart', () => {
    const full = v3(42, 700).pixels;
    expect(v3(42, 700).pixels).toEqual(full);
    for (const cut of [1, 9, 150, 433]) {
      const sim = new Simulation({ gameId: 'test', initialSeed: 42, generatorVersion: 3 }, full.slice(0, cut));
      for (let i = cut; i < 700; i++) {
        expect(sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt((9 + i) % 24), environmentSnapshotId: null }).pixel).toEqual(full[i]);
      }
    }
  });

  it('most individuals end up with two painted eyes by ~30 days, some stay abstract', () => {
    let faces = 0, abstract = 0, tendrils = 0;
    for (let k = 1; k <= 30; k++) {
      const { sim } = v3(k * 7919, 720);
      if (!sim.plans.length) { abstract++; continue; }
      if ((sim.currentAnalysis()?.face?.eyesFromHoles ?? 0) >= 2) faces++;
      tendrils += sim.genome.limbs.length;
    }
    console.info(`[kawaii] two painted eyes at 720 dots: ${faces}/30, abstract: ${abstract}/30`);
    expect(faces).toBeGreaterThanOrEqual(20);
    expect(abstract).toBeGreaterThan(0);
    expect(tendrils).toBe(0); // no thin tendril limbs; ears/feet come from the rounded body plan
  });

  it('painted features only colour new dots: existing dots never change; bias 0 grows without a face', () => {
    const { sim, pixels } = v3(1234, 300);
    const before = JSON.stringify(pixels);
    for (let i = 300; i < 700; i++) sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt(12, 'rain', 1), environmentSnapshotId: null });
    expect(JSON.stringify(pixels)).toBe(before);
    const flat = v3(1234, 720, 0).pixels;
    expect(new Set(flat.map((p) => `${p.x},${p.y}`)).size).toBe(720);
    const dark = flat.filter((p) => parseInt(p.color.slice(1, 3), 16) + parseInt(p.color.slice(3, 5), 16) + parseInt(p.color.slice(5, 7), 16) < 150).length;
    expect(dark).toBeLessThan(5);
  });
});
