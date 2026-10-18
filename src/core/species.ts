import type { BlobGene, Genome, MarkGene } from './genome';
import { Rng, hash32 } from './rng';

/**
 * Animal looks layered on the cute / cool genomes (v3+). Every feature is a
 * tendency: silhouettes come from rounded body-plan lobes, markings are colour
 * tendencies on dots that later land there, and faces stay optional. Uses its
 * own random stream, so the base genomes are unaffected.
 */
export const CUTE_SPECIES = ['bear', 'dog', 'chick', 'frog', 'hamster', 'pig', 'penguin'] as const;
export const COOL_SPECIES = ['fox', 'wolf', 'bat', 'owl', 'tiger', 'dragon'] as const;
export type Species = (typeof CUTE_SPECIES)[number] | (typeof COOL_SPECIES)[number];
export const ALL_SPECIES: readonly Species[] = [...CUTE_SPECIES, ...COOL_SPECIES];

export const SPECIES_LABEL: Record<Species, string> = {
  bear: 'くま',
  dog: 'いぬ',
  chick: 'ひよこ',
  frog: 'かえる',
  hamster: 'ハムスター',
  pig: 'ぶた',
  penguin: 'ペンギン',
  fox: 'きつね',
  wolf: 'おおかみ',
  bat: 'こうもり',
  owl: 'ふくろう',
  tiger: 'とら',
  dragon: 'ドラゴン',
};

export function isCoolSpecies(s: Species): boolean {
  return (COOL_SPECIES as readonly string[]).includes(s);
}

type Hsl = { h: number; s: number; l: number };
const mark = (cx: number, cy: number, rx: number, ry: number, c: Hsl, dot = false): MarkGene => ({ cx, cy, rx, ry, ...c, dot });
const area = (blobs: BlobGene[]) => blobs.reduce((sum, b) => sum + b.rx * b.ry, 0);
const INK: Hsl = { h: 270, s: 0.3, l: 0.15 };

/** Eyes in head units; ey/mouth in head-relative fractions like the other v3 genomes. */
function face(g: Genome, sep: number, ey: number, size: number, mouthY: number, mouthWidth: number, curve: number) {
  g.eyes = [{ dx: -sep, dy: ey, size }, { dx: sep, dy: ey, size }];
  g.hasMouth = mouthWidth > 0;
  g.mouthY = mouthY;
  g.mouthWidth = mouthWidth;
  g.mouthCurve = curve;
  g.mouthDx = 0;
  g.mouthO = undefined;
}

function palette(g: Genome, c: Hsl) {
  g.hue = c.h;
  g.paletteHues = [c.h, (c.h + 6) % 360, (c.h + 354) % 360];
  g.paletteWeights = [1, 0.3, 0.3];
  g.saturation = c.s;
  g.lightness = c.l;
  g.pattern = 'plain';
  g.patternStrength = 0.06;
  g.patternScale = 12;
}

/** Pointed ear: a tall narrow lobe topped by a smaller one. */
function pointedEars(blobs: BlobGene[], head: BlobGene, spread: number, h: number, w = 0.15) {
  for (const sgn of [-1, 1]) {
    blobs.push({ ox: sgn * head.rx * spread, oy: -head.ry * 0.88, rx: w, ry: h });
    blobs.push({ ox: sgn * (head.rx * spread + 0.05), oy: -head.ry * 0.9 - h * 0.9, rx: w * 0.5, ry: h * 0.38 });
  }
}

function roundEars(blobs: BlobGene[], head: BlobGene, spread: number, r: number, up = 0.84) {
  for (const sgn of [-1, 1]) blobs.push({ ox: sgn * head.rx * spread, oy: -head.ry * up, rx: r, ry: r });
}

function feet(blobs: BlobGene[], bottom: BlobGene, r = 0.2) {
  for (const sgn of [-1, 1]) blobs.push({ ox: sgn * bottom.rx * 0.45, oy: bottom.oy + bottom.ry * 0.9, rx: r * 1.15, ry: r * 0.75 });
}

export function applySpecies(g: Genome, species: Species, initialSeed: number, generatorVersion: number): Genome {
  const r = new Rng(hash32(initialSeed, 'species', species, generatorVersion));
  const out: Genome = { ...g, limbs: [], limbAffinity: 0, crestHue: undefined, hasFang: false, mouthO: undefined, shineInset: undefined, firmFace: true };
  const blobs: BlobGene[] = [];
  const marks: MarkGene[] = [];
  const head: BlobGene = { ox: 0, oy: 0, rx: r.range(1.0, 1.08), ry: r.range(0.88, 0.96) };
  blobs.push(head);
  const ey = r.range(-0.02, 0.08); // eye height in head units
  const eyeYb = ey * head.ry; // eye height in body-plan units
  const lighter = (c: Hsl, dl: number, ds = -0.1): Hsl => ({ h: c.h, s: Math.max(0.05, c.s + ds), l: Math.min(0.94, c.l + dl) });

  switch (species) {
    case 'bear': {
      const c = r.pick<Hsl>([
        { h: r.range(24, 32), s: r.range(0.32, 0.45), l: r.range(0.55, 0.63) },
        { h: r.range(34, 42), s: r.range(0.5, 0.6), l: r.range(0.66, 0.72) },
        { h: r.range(20, 30), s: 0.12, l: r.range(0.86, 0.9) },
        { h: r.range(335, 350), s: 0.35, l: 0.8 },
      ]);
      palette(out, c);
      roundEars(blobs, head, 0.66, r.range(0.25, 0.29));
      if (r.chance(0.4)) {
        blobs.push({ ox: 0, oy: 1.0, rx: 0.66, ry: 0.5 });
        feet(blobs, blobs[blobs.length - 1]);
      }
      for (const sgn of [-1, 1]) marks.push(mark(sgn * head.rx * 0.66, -head.ry * 0.84, 0.13, 0.13, lighter(c, 0.12, 0.1)));
      const my = eyeYb + 0.33;
      marks.push(mark(0, my, 0.3, 0.21, lighter(c, 0.2)));
      marks.push(mark(0, my - 0.07, 0.075, 0.05, INK, true));
      face(out, r.range(0.34, 0.4), ey, r.range(0.13, 0.16), (my + 0.07) / head.ry, 0.06, 0.6);
      out.hasCheeks = r.chance(0.7);
      break;
    }
    case 'dog': {
      const cream = r.chance(0.5);
      const c: Hsl = cream ? { h: r.range(32, 40), s: 0.2, l: r.range(0.84, 0.88) } : { h: r.range(26, 34), s: r.range(0.45, 0.55), l: r.range(0.62, 0.68) };
      const earC: Hsl = { h: c.h - 4, s: 0.45, l: cream ? 0.5 : 0.4 };
      palette(out, c);
      head.rx = r.range(1.04, 1.12);
      for (const sgn of [-1, 1]) {
        const ear: BlobGene = { ox: sgn * (head.rx + 0.02), oy: -0.2, rx: r.range(0.24, 0.28), ry: r.range(0.45, 0.55) };
        blobs.push(ear);
        marks.push(mark(ear.ox, ear.oy, ear.rx, ear.ry, earC));
      }
      const my = eyeYb + 0.32;
      if (!cream) marks.push(mark(0, my, 0.32, 0.22, lighter(c, 0.22)));
      if (r.chance(0.3)) {
        const side = r.chance(0.5) ? -1 : 1;
        marks.push(mark(side * 0.38 * head.rx, eyeYb, 0.24, 0.24, earC)); // eye patch
      }
      marks.push(mark(0, my - 0.08, 0.09, 0.06, INK, true));
      if (r.chance(0.4)) marks.push(mark(0, my + 0.12, 0.05, 0.05, { h: 350, s: 0.65, l: 0.68 }, true)); // tongue
      face(out, r.range(0.34, 0.4), ey, r.range(0.13, 0.16), (my + 0.04) / head.ry, 0.07, 0.6);
      out.hasCheeks = r.chance(0.5);
      break;
    }
    case 'chick': {
      const c: Hsl = { h: r.range(47, 54), s: r.range(0.75, 0.85), l: r.range(0.7, 0.76) };
      const orange: Hsl = { h: 28, s: 0.9, l: 0.58 };
      palette(out, c);
      head.ry = head.rx * r.range(0.92, 0.98);
      blobs.push({ ox: 0.02, oy: -head.ry * 1.02, rx: 0.08, ry: 0.13 }, { ox: 0.13, oy: -head.ry * 1.06, rx: 0.07, ry: 0.1 });
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * head.rx * 0.98, oy: 0.15, rx: 0.2, ry: 0.27 });
      for (const sgn of [-1, 1]) {
        const foot: BlobGene = { ox: sgn * 0.3, oy: head.ry * 0.98, rx: 0.17, ry: 0.1 };
        blobs.push(foot);
        marks.push(mark(foot.ox, foot.oy + 0.03, foot.rx, foot.ry, orange));
      }
      marks.push(mark(0, eyeYb + 0.17, 0.1, 0.07, orange, true)); // beak
      face(out, r.range(0.3, 0.36), ey, r.range(0.12, 0.14), 0, 0, 0);
      out.hasCheeks = true;
      break;
    }
    case 'frog': {
      const c: Hsl = { h: r.range(100, 130), s: r.range(0.45, 0.6), l: r.range(0.55, 0.63) };
      palette(out, c);
      head.rx = r.range(1.2, 1.3);
      head.ry = r.range(0.76, 0.84);
      head.oy = 0.05;
      const bump = { x: 0.55, y: -0.6, rx: r.range(0.3, 0.34), ry: r.range(0.27, 0.3) };
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * bump.x, oy: bump.y, rx: bump.rx, ry: bump.ry });
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * 0.62, oy: head.oy + head.ry * 0.95, rx: 0.26, ry: 0.12 });
      marks.push(mark(0, 0.42, 0.78, 0.36, { h: c.h - 40, s: 0.45, l: Math.min(0.88, c.l + 0.22) }));
      face(out, bump.x / head.rx, (bump.y - head.oy) / head.ry, r.range(0.12, 0.15), r.range(0.12, 0.22), r.range(0.36, 0.46), r.range(0.5, 0.9));
      out.hasCheeks = r.chance(0.8);
      break;
    }
    case 'hamster': {
      const c = r.pick<Hsl>([
        { h: r.range(28, 34), s: 0.55, l: r.range(0.68, 0.73) },
        { h: r.range(38, 44), s: 0.6, l: 0.74 },
        { h: 30, s: 0.06, l: r.range(0.62, 0.7) },
      ]);
      palette(out, c);
      head.rx = r.range(1.12, 1.2);
      roundEars(blobs, head, 0.56, r.range(0.16, 0.19), 0.86);
      for (const sgn of [-1, 1]) marks.push(mark(sgn * head.rx * 0.56, -head.ry * 0.86, 0.09, 0.09, { h: 350, s: 0.55, l: 0.8 }));
      feet(blobs, head, 0.17);
      marks.push(mark(0, 0.38, 0.85, 0.52, { h: c.h, s: 0.12, l: 0.93 }));
      marks.push(mark(0, eyeYb + 0.2, 0.05, 0.035, { h: 350, s: 0.6, l: 0.68 }, true));
      face(out, r.range(0.36, 0.42), ey, r.range(0.12, 0.14), (eyeYb + 0.29) / head.ry, 0.06, 0.8);
      out.hasCheeks = true;
      break;
    }
    case 'pig': {
      const c: Hsl = { h: r.range(345, 355), s: r.range(0.5, 0.6), l: r.range(0.78, 0.82) };
      palette(out, c);
      pointedEars(blobs, head, 0.55, 0.16, 0.16);
      const sy = eyeYb + 0.28;
      marks.push(mark(0, sy, 0.22, 0.15, { h: c.h, s: 0.6, l: c.l - 0.1 }));
      for (const sgn of [-1, 1]) marks.push(mark(sgn * 0.07, sy, 0.035, 0.045, { h: 345, s: 0.4, l: 0.42 }, true));
      feet(blobs, head, 0.18);
      face(out, r.range(0.36, 0.42), ey - 0.05, r.range(0.1, 0.13), (sy + 0.22) / head.ry, 0.05, 0.6);
      out.hasCheeks = true;
      break;
    }
    case 'penguin': {
      const c: Hsl = { h: r.range(215, 230), s: r.range(0.3, 0.4), l: r.range(0.32, 0.38) };
      const orange: Hsl = { h: 32, s: 0.9, l: 0.6 };
      palette(out, c);
      head.rx = r.range(0.88, 0.94);
      head.ry = r.range(1.05, 1.12);
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * head.rx * 1.02, oy: 0.2, rx: 0.16, ry: 0.34 });
      for (const sgn of [-1, 1]) {
        const foot: BlobGene = { ox: sgn * 0.3, oy: head.ry * 0.97, rx: 0.19, ry: 0.1 };
        blobs.push(foot);
        marks.push(mark(foot.ox, foot.oy + 0.02, foot.rx, foot.ry, orange));
      }
      marks.push(mark(0, 0.2, 0.68, 0.82, { h: c.h, s: 0.05, l: 0.93 }));
      const pey = r.range(-0.12, -0.04);
      marks.push(mark(0, pey * head.ry + 0.17, 0.1, 0.065, orange, true));
      face(out, r.range(0.36, 0.42), pey, r.range(0.12, 0.14), 0, 0, 0);
      out.hasCheeks = true;
      out.cheekHue = 345;
      break;
    }
    case 'fox':
    case 'wolf': {
      const fox = species === 'fox';
      const c: Hsl = fox ? { h: r.range(21, 27), s: r.range(0.6, 0.68), l: r.range(0.55, 0.6) } : { h: r.range(208, 222), s: r.range(0.1, 0.18), l: r.range(0.5, 0.58) };
      const white: Hsl = { h: c.h, s: 0.08, l: 0.92 };
      palette(out, c);
      head.ry = r.range(0.84, 0.9);
      pointedEars(blobs, head, 0.6, r.range(0.4, 0.48), 0.17);
      for (const sgn of [-1, 1]) marks.push(mark(sgn * head.rx * 0.6, -head.ry * 0.98, 0.1, 0.2, fox ? { h: 30, s: 0.25, l: 0.88 } : { h: c.h, s: 0.15, l: 0.82 }));
      const side = r.chance(0.5) ? 1 : -1;
      const tail: BlobGene[] = [
        { ox: side * 0.95, oy: 0.6, rx: 0.32, ry: 0.24 },
        { ox: side * 1.28, oy: 0.4, rx: 0.26, ry: 0.24 },
        { ox: side * 1.45, oy: 0.15, rx: 0.19, ry: 0.2 },
      ];
      blobs.push(...tail);
      marks.push(mark(tail[2].ox, tail[2].oy, tail[2].rx, tail[2].ry, white));
      for (const sgn of [-1, 1]) marks.push(mark(sgn * 0.3, eyeYb + 0.38, 0.36, 0.26, white));
      marks.push(mark(0, eyeYb + 0.24, 0.07, 0.05, INK, true));
      face(out, r.range(0.36, 0.42), ey, r.range(0.15, 0.18), (eyeYb + 0.34) / head.ry, 0.06, 0.4);
      out.irisHue = fox ? r.pick([100, 110, 190]) : r.pick([188, 196, 48]); // contrast with the body
      out.hasFang = !fox && r.chance(0.6);
      break;
    }
    case 'bat': {
      const c: Hsl = { h: r.range(265, 285), s: r.range(0.28, 0.36), l: r.range(0.3, 0.36) };
      palette(out, c);
      pointedEars(blobs, head, 0.58, r.range(0.46, 0.54), 0.19);
      for (const sgn of [-1, 1]) marks.push(mark(sgn * head.rx * 0.58, -head.ry * 0.98, 0.11, 0.22, { h: 320, s: 0.35, l: 0.55 }));
      for (const sgn of [-1, 1]) {
        blobs.push({ ox: sgn * 1.22, oy: 0.08, rx: 0.42, ry: 0.24 });
        blobs.push({ ox: sgn * 1.5, oy: 0.28, rx: 0.24, ry: 0.2 });
        blobs.push({ ox: sgn * 1.1, oy: 0.32, rx: 0.2, ry: 0.17 });
      }
      face(out, r.range(0.36, 0.42), ey, r.range(0.15, 0.18), (eyeYb + 0.34) / head.ry, 0.07, 0.3);
      out.irisHue = r.pick([48, 300, 188]);
      out.hasFang = true;
      break;
    }
    case 'owl': {
      const c: Hsl = { h: r.range(24, 32), s: r.range(0.32, 0.4), l: r.range(0.42, 0.5) };
      palette(out, c);
      head.ry = r.range(0.98, 1.04);
      for (const sgn of [-1, 1]) {
        blobs.push({ ox: sgn * head.rx * 0.66, oy: -head.ry * 0.9, rx: 0.12, ry: 0.22 });
        blobs.push({ ox: sgn * head.rx * 0.74, oy: -head.ry * 1.12, rx: 0.06, ry: 0.1 });
      }
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * head.rx * 0.98, oy: 0.3, rx: 0.15, ry: 0.4 });
      const sep = r.range(0.34, 0.38);
      const size = r.range(0.14, 0.17);
      for (const sgn of [-1, 1]) marks.push(mark(sgn * sep * head.rx, eyeYb, size * 2.1, size * 2.1, { h: 40, s: 0.3, l: 0.85 }));
      marks.push(mark(0, 0.55, 0.55, 0.4, lighter(c, 0.18, 0)));
      marks.push(mark(0, eyeYb + 0.2, 0.08, 0.08, { h: 36, s: 0.85, l: 0.58 }, true));
      face(out, sep, ey, size, 0, 0, 0);
      out.irisHue = r.pick([40, 46, 30]);
      out.eyeTilt = 0.08;
      break;
    }
    case 'tiger': {
      const c: Hsl = { h: r.range(26, 32), s: r.range(0.62, 0.7), l: r.range(0.55, 0.6) };
      const stripe: Hsl = { h: 20, s: 0.4, l: 0.18 };
      palette(out, c);
      roundEars(blobs, head, 0.66, r.range(0.22, 0.25));
      for (const sgn of [-1, 1]) marks.push(mark(sgn * head.rx * 0.66, -head.ry * 0.84, 0.11, 0.11, { h: c.h, s: 0.1, l: 0.9 }));
      marks.push(mark(0, eyeYb + 0.33, 0.36, 0.24, { h: c.h, s: 0.08, l: 0.93 }));
      marks.push(mark(0, -0.6, 0.04, 0.14, stripe), mark(-0.18, -0.6, 0.035, 0.11, stripe), mark(0.18, -0.6, 0.035, 0.11, stripe));
      for (const sgn of [-1, 1]) {
        marks.push(mark(sgn * 0.88 * head.rx, -0.12, 0.14, 0.04, stripe));
        marks.push(mark(sgn * 0.92 * head.rx, 0.14, 0.15, 0.04, stripe));
      }
      marks.push(mark(0, eyeYb + 0.24, 0.07, 0.05, { h: 350, s: 0.5, l: 0.6 }, true));
      feet(blobs, head, 0.2);
      face(out, r.range(0.36, 0.42), ey, r.range(0.15, 0.18), (eyeYb + 0.35) / head.ry, 0.06, 0.4);
      out.irisHue = r.pick([104, 190, 90]);
      break;
    }
    case 'dragon': {
      const c = r.pick<Hsl>([
        { h: r.range(150, 172), s: r.range(0.42, 0.52), l: r.range(0.42, 0.5) },
        { h: r.range(262, 280), s: 0.4, l: 0.45 },
        { h: r.range(205, 220), s: 0.45, l: 0.45 },
      ]);
      palette(out, c);
      const horn: Hsl = { h: 45, s: 0.45, l: 0.86 };
      for (const sgn of [-1, 1]) {
        // horns sweeping up and outward, drawn in a light horn colour
        const parts: BlobGene[] = [
          { ox: sgn * head.rx * 0.36, oy: -head.ry * 1.0, rx: 0.15, ry: 0.2 },
          { ox: sgn * head.rx * 0.48, oy: -head.ry * 1.26, rx: 0.12, ry: 0.17 },
          { ox: sgn * head.rx * 0.62, oy: -head.ry * 1.48, rx: 0.08, ry: 0.12 },
        ];
        blobs.push(...parts);
        for (const p of parts.slice(1)) marks.push(mark(p.ox, p.oy, p.rx + 0.02, p.ry + 0.02, horn));
      }
      const body: BlobGene = { ox: 0, oy: 1.0, rx: 0.64, ry: 0.5 };
      blobs.push(body);
      const wingC: Hsl = { h: c.h, s: c.s, l: Math.max(0.22, c.l - 0.14) };
      for (const sgn of [-1, 1]) {
        // small bat-like wings behind the shoulders
        const w: BlobGene[] = [
          { ox: sgn * 0.95, oy: 0.6, rx: 0.36, ry: 0.24 },
          { ox: sgn * 1.3, oy: 0.4, rx: 0.26, ry: 0.27 },
          { ox: sgn * 1.5, oy: 0.66, rx: 0.17, ry: 0.17 },
        ];
        blobs.push(...w);
        for (const p of w) marks.push(mark(p.ox, p.oy, p.rx, p.ry, wingC));
      }
      feet(blobs, body, 0.18);
      const side = r.chance(0.5) ? 1 : -1;
      blobs.push(
        { ox: side * 0.72, oy: 1.3, rx: 0.28, ry: 0.14 },
        { ox: side * 1.0, oy: 1.22, rx: 0.16, ry: 0.13 },
        { ox: side * 1.18, oy: 1.08, rx: 0.12, ry: 0.14 },
      );
      marks.push(mark(side * 1.2, 1.04, 0.1, 0.1, horn)); // tail tip
      marks.push(mark(0, 1.05, 0.38, 0.36, { h: 48, s: 0.5, l: 0.78 }));
      face(out, r.range(0.36, 0.42), ey, r.range(0.15, 0.18), (eyeYb + 0.34) / head.ry, 0.07, 0.3);
      out.irisHue = r.pick([48, 42, 188]);
      out.hasFang = r.chance(0.7);
      break;
    }
  }
  out.blobs = blobs;
  out.blobArea = area(blobs);
  out.marks = marks;
  out.faceAffinity = r.chance(0.06) ? r.range(0, 0.05) : r.range(0.85, 1);
  out.symmetry = r.range(1.3, 1.8);
  out.compactness = r.range(2.3, 2.7);
  if (!isCoolSpecies(species)) {
    out.irisHue = undefined;
    out.eyeAspect = undefined;
    out.eyeTilt = undefined;
  } else {
    out.eyeAspect = out.eyeAspect ?? r.range(0.8, 0.9);
    out.eyeTilt = out.eyeTilt ?? r.range(0.18, 0.3);
    out.hasCheeks = false;
  }
  return out;
}
