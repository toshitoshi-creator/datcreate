import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { analyzeShape } from '../../src/core/analysis';
import { Simulation } from '../../src/core/generator';
import { hexToHsl } from '../../src/core/color';
import { ALL_SPECIES, isCoolSpecies, type Species } from '../../src/core/species';
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

describe("generator v3 'cool' style (かっこかわいい)", () => {
  const cool = (seed: number, n: number) => grow(seed, n, (i) => envAt((9 + i) % 24), 3, 'cool');
  const fpStyle = (seed: number) =>
    createHash('sha256').update(cool(seed, 900).pixels.map((p) => `${p.x},${p.y},${p.color}`).join('|')).digest('hex').slice(0, 16);

  it('output is frozen', () => {
    expect([42, 7919, 2654435761].map(fpStyle)).toEqual(['bc613c04349bc961', '855f21eff5ab60a4', 'f751266877c15481']);
  });

  it('differs from the cute style for the same seed, and resumes identically after a restart', () => {
    const full = cool(42, 600).pixels;
    expect(full.map((p) => p.color)).not.toEqual(grow(42, 600, (i) => envAt((9 + i) % 24), 3).pixels.map((p) => p.color));
    for (const cut of [1, 200, 451]) {
      const sim = new Simulation({ gameId: 'test', initialSeed: 42, generatorVersion: 3, style: 'cool' }, full.slice(0, cut));
      for (let i = cut; i < 600; i++) {
        expect(sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt((9 + i) % 24), environmentSnapshotId: null }).pixel).toEqual(full[i]);
      }
    }
  });

  it('usually grows glowing eyes on a darker body, without tendrils', () => {
    let faces = 0, abstract = 0, darker = 0;
    for (let k = 1; k <= 30; k++) {
      const { sim } = cool(k * 7919, 720);
      expect(sim.genome.limbs).toHaveLength(0);
      if (sim.genome.lightness < 0.5) darker++;
      if (!sim.plans.length) { abstract++; continue; }
      if ((sim.currentAnalysis()?.face?.eyesFromHoles ?? 0) >= 2) faces++;
      expect(sim.genome.irisHue).toBeDefined();
    }
    console.info(`[cool] two glowing eyes at 720 dots: ${faces}/30, abstract: ${abstract}/30`);
    expect(faces).toBeGreaterThanOrEqual(20);
    expect(darker).toBe(30);
  });
});

describe('generator v3 ghost styles (おばけ)', () => {
  const ghost = (seed: number, n: number, style: 'ghost' | 'ghostCool') => grow(seed, n, (i) => envAt((9 + i) % 24), 3, style);
  const fpStyle = (seed: number, style: 'ghost' | 'ghostCool') =>
    createHash('sha256').update(ghost(seed, 900, style).pixels.map((p) => `${p.x},${p.y},${p.color}`).join('|')).digest('hex').slice(0, 16);

  it('outputs are frozen', () => {
    expect([42, 7919, 2654435761].map((s) => fpStyle(s, 'ghost'))).toEqual(['3cbd443c29d2e59f', 'cbf52f44473ec782', 'a0956681560b8632']);
    expect([42, 7919, 2654435761].map((s) => fpStyle(s, 'ghostCool'))).toEqual(['7214635152949579', '4e39d69fc3833528', 'b43f9f80ef497f5b']);
  });

  it('resumes identically after a restart', () => {
    for (const style of ['ghost', 'ghostCool'] as const) {
      const full = ghost(42, 500, style).pixels;
      for (const cut of [1, 120, 333]) {
        const sim = new Simulation({ gameId: 'test', initialSeed: 42, generatorVersion: 3, style }, full.slice(0, cut));
        for (let i = cut; i < 500; i++) {
          expect(sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt((9 + i) % 24), environmentSnapshotId: null }).pixel).toEqual(full[i]);
        }
      }
    }
  });

  it('stay friendly: faces form, pale cute ghosts with dark eyes, cool ghosts never get red eyes', () => {
    for (const style of ['ghost', 'ghostCool'] as const) {
      let faces = 0;
      for (let k = 1; k <= 30; k++) {
        const { sim } = ghost(k * 7919, 720, style);
        const g = sim.genome;
        expect(g.limbs).toHaveLength(0);
        expect(g.blobs.length).toBeGreaterThanOrEqual(4); // dome + hem / wisp lobes
        if (style === 'ghost') {
          expect(g.lightness).toBeGreaterThan(0.8);
          expect(g.irisHue).toBeUndefined();
        } else {
          const h = g.irisHue!;
          expect(h > 20 && h < 330).toBe(true); // no red glow
        }
        if (sim.plans.length && (sim.currentAnalysis()?.face?.eyesFromHoles ?? 0) >= 2) faces++;
      }
      console.info(`[${style}] two eyes at 720 dots: ${faces}/30`);
      expect(faces).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('v3 animal looks (species)', () => {
  const famOf = (sp: Species) => (isCoolSpecies(sp) ? 'cool' : 'cute');
  const growSp = (seed: number, n: number, sp: Species) => grow(seed, n, (i) => envAt((9 + i) % 24), 3, famOf(sp), sp);

  it('outputs are frozen', () => {
    const fps = Object.fromEntries(
      ALL_SPECIES.map((sp) => [sp, createHash('sha256').update(grow(42, 900, undefined, 3, famOf(sp), sp).pixels.map((p) => `${p.x},${p.y},${p.color}`).join('|')).digest('hex').slice(0, 16)]),
    );
    expect(fps).toEqual({
      bear: 'e3a81c901965e028',
      dog: '0ddbcfb2167d3fc4',
      chick: '6ad60d0b10c81a15',
      frog: '1fe84783a64e1db5',
      hamster: 'bf6e5b53034f786d',
      pig: 'a31ee857e7086051',
      penguin: '2b4f1b51ee058ce7',
      fox: 'c3d21776fff98a5a',
      wolf: 'a2a72afd1f46c8aa',
      bat: 'bde9373caff253ba',
      owl: '5fdc02dc67cd8dc4',
      tiger: '9b4416cc0f4fbc1c',
      dragon: '7ffceffc28be94d4',
    });
  });

  it('each animal resumes identically after a restart and never stacks dots', () => {
    for (const sp of ALL_SPECIES) {
      const full = growSp(7, 400, sp).pixels;
      expect(new Set(full.map((p) => `${p.x},${p.y}`)).size).toBe(400);
      for (const cut of [1, 5, 9, 150]) {
        const sim = new Simulation({ gameId: 'test', initialSeed: 7, generatorVersion: 3, style: famOf(sp), species: sp }, full.slice(0, cut));
        for (let i = cut; i < 400; i++) {
          expect(sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envAt((9 + i) % 24), environmentSnapshotId: null }).pixel).toEqual(full[i]);
        }
      }
    }
  });

  it('most individuals of every animal finish their eyes and markings by 30 days', () => {
    for (const sp of ALL_SPECIES) {
      let faces = 0, marked = 0;
      for (let k = 1; k <= 12; k++) {
        const { sim, pixels } = growSp(k * 7919, 720, sp);
        expect(sim.genome.limbs).toHaveLength(0);
        if (!sim.plans.length) continue;
        if ((sim.currentAnalysis()?.face?.eyesFromHoles ?? 0) >= 2) faces++;
        // at least one marking colour actually shows up on the body
        const mark = sim.genome.marks![0];
        if (pixels.some((p) => Math.abs(hexToHsl(p.color).l - mark.l) < 0.04 && Math.abs(((hexToHsl(p.color).h - mark.h + 540) % 360) - 180) < 12)) marked++;
      }
      console.info(`[${sp}] eyes ${faces}/12, markings ${marked}/12`);
      expect(faces).toBeGreaterThanOrEqual(9);
      expect(marked).toBeGreaterThanOrEqual(9);
    }
  });

  it('cool animals never get red eyes; cute animals keep dark eyes', () => {
    for (const sp of ALL_SPECIES) {
      for (let k = 1; k <= 10; k++) {
        const g = growSp(k, 1, sp).sim.genome;
        if (isCoolSpecies(sp)) expect(g.irisHue! > 20 && g.irisHue! < 330).toBe(true);
        else expect(g.irisHue).toBeUndefined();
      }
    }
  });
});
