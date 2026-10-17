import type { AccentKind } from './analysis';
import { clamp, pullHue, wrapHue, type Hsl } from './color';
import type { Genome } from './genome';
import { N8, type GrowthModel } from './model';
import type { Rng } from './rng';
import { noise2 } from './noise';
import type { Tuning } from './tuning';
import type { EnvUsed } from './types';

/** Circular mean colour of occupied 8-neighbours (or null). */
function neighbourColor(model: GrowthModel, x: number, y: number): Hsl | null {
  let sx = 0, sy = 0, s = 0, l = 0, k = 0;
  for (const [dx, dy] of N8) {
    const c = model.get(x + dx, y + dy);
    if (!c) continue;
    const a = (c.h * Math.PI) / 180;
    sx += Math.cos(a) * (c.s + 0.05);
    sy += Math.sin(a) * (c.s + 0.05);
    s += c.s;
    l += c.l;
    k++;
  }
  if (!k) return null;
  return { h: wrapHue((Math.atan2(sy, sx) * 180) / Math.PI), s: s / k, l: l / k };
}

/** Palette region at a cell according to the individual's marking pattern. */
function patternTarget(genome: Genome, x: number, y: number, rng: Rng): Hsl {
  const sc = genome.patternScale;
  let v: number;
  switch (genome.pattern) {
    case 'stripes-h': v = Math.sin((y / sc) * Math.PI + noise2(genome.colorSeed, x, y, sc * 3) * 1.5); break;
    case 'stripes-v': v = Math.sin((x / sc) * Math.PI + noise2(genome.colorSeed, x, y, sc * 3) * 1.5); break;
    case 'rings': v = Math.sin((Math.hypot(x, y) / sc) * Math.PI * 0.8 + noise2(genome.colorSeed, x, y, sc * 2)); break;
    case 'speckle': v = rng.next() * 2 - 1; break;
    case 'plain': v = noise2(genome.colorSeed, x, y, sc * 4) * 0.6; break;
    default: v = noise2(genome.colorSeed, x, y, sc) * 1.4;
  }
  const idx = v > 0.45 ? 1 : v < -0.55 ? 2 : 0;
  const shade = noise2(genome.colorSeed ^ 0x51ed27, x, y, sc * 1.7) * 0.07;
  return { h: genome.paletteHues[idx], s: genome.saturation, l: genome.lightness + shade + (idx === 2 ? -0.06 : 0) };
}

/**
 * Colour of a new pixel. Neighbour colour is blended toward the marking
 * pattern so an individual keeps a coherent palette with emergent markings.
 * Time and weather shift the *distribution* probabilistically.
 */
export function generateColor(
  rng: Rng,
  model: GrowthModel,
  x: number,
  y: number,
  genome: Genome,
  env: EnvUsed,
  accent: AccentKind | undefined,
  faceStrength: number,
  tune: Tuning,
  inFace: boolean,
): Hsl {
  const w = env.environmentInfluence;
  // shifts of individual dots; v2 keeps faces readable by calming the face area
  const wc = w * tune.envColorChance * (inFace ? 1 - tune.faceColorCalm : 1);
  const target = patternTarget(genome, x, y, rng);
  const nb = neighbourColor(model, x, y);
  let c: Hsl;
  if (nb && rng.chance(genome.inheritance)) {
    const ps = genome.patternStrength * (inFace ? 1 - tune.faceColorCalm : 1);
    const jitter = inFace ? 1 - tune.faceColorCalm * 0.7 : 1;
    c = {
      h: pullHue(nb.h, target.h, ps) + rng.gauss() * 4 * jitter,
      s: nb.s + (target.s - nb.s) * ps + rng.gauss() * 0.03 * jitter,
      l: nb.l + (target.l - nb.l) * ps + rng.gauss() * 0.03 * jitter,
    };
  } else {
    c = { h: target.h + rng.gauss() * 8, s: target.s + rng.gauss() * 0.06, l: target.l + rng.gauss() * 0.05 };
  }
  if (rng.chance(genome.volatility * 0.15)) c.h += rng.gauss() * 40;

  // time of day ---------------------------------------------------------
  const t = rng.next();
  switch (env.timeOfDay) {
    case 'morning':
      if (t < 0.45 * wc) { c.l += 0.07; c.s -= 0.07; }
      break;
    case 'day':
      if (t < 0.45 * wc) { c.s += 0.09; c.l += 0.02; }
      break;
    case 'evening':
      if (t < 0.45 * wc) c.h = pullHue(c.h, rng.range(5, 40), rng.range(0.15, 0.45));
      break;
    case 'night':
      if (t < 0.45 * wc) { c.l -= 0.1; c.s -= 0.03; }
      if (rng.chance(0.05 * w * tune.sparkScale)) { c.l = rng.range(0.75, 0.9); c.s = rng.range(0.6, 1); }
      break;
  }

  // weather ---------------------------------------------------------------
  const u = rng.next();
  switch (env.weather) {
    case 'clear':
      if (u < 0.45 * wc) { c.h = pullHue(c.h, 45, rng.range(0.1, 0.35)); c.l += 0.04; }
      break;
    case 'cloudy':
      if (u < 0.55 * wc) c.s *= 0.7;
      break;
    case 'rain':
      if (u < 0.4 * wc) c.h = pullHue(c.h, rng.range(195, 235), rng.range(0.25, 0.6));
      break;
    case 'storm':
      if (u < 0.35 * wc) c.h = pullHue(c.h, rng.range(230, 280), rng.range(0.25, 0.6));
      if (rng.chance(0.04 * w * tune.sparkScale)) { c.l = 0.88; c.s = 0.4; }
      break;
    case 'snow':
      if (u < 0.4 * wc) { c.s *= 0.4; c.l = Math.max(c.l, rng.range(0.78, 0.9)); }
      break;
    case 'fog':
      if (u < 0.5 * wc) { c.s *= 0.6; c.l += 0.05; }
      break;
    case 'unknown':
      break;
  }

  // weak facial colour accents (probabilistic) ----------------------------
  if (accent && rng.chance(tune.accentBase + tune.accentGain * faceStrength * env.organicShapeBias)) {
    if (accent === 'eye' && tune.crispEyes) {
      c = { h: c.h, s: rng.range(0.04, 0.14), l: rng.range(0.88, 0.96) };
    } else if (accent === 'eyeRim' && tune.crispEyes) {
      c.l -= rng.range(0.06, 0.14);
    } else if (accent === 'eye') {
      c = rng.chance(0.6)
        ? { h: c.h, s: rng.range(0.05, 0.3), l: rng.range(0.85, 0.96) }
        : { h: c.h + 180 + rng.gauss() * 20, s: rng.range(0.7, 1), l: rng.range(0.6, 0.75) };
    } else if (accent === 'eyeRim') {
      if (rng.chance(0.5)) c.l = c.l > 0.5 ? c.l + 0.12 : c.l - 0.1;
    } else if (accent === 'cheek') {
      c = { h: genome.cheekHue + rng.gauss() * 8, s: rng.range(0.55, 0.8), l: Math.max(c.l, rng.range(0.62, 0.72)) };
    } else if (accent === 'nose') {
      c.h += 30 * rng.range(0.5, 1.2);
      c.l -= 0.08;
      c.s += 0.1;
    }
  }

  return { h: wrapHue(c.h), s: clamp(c.s, 0.04, 1), l: clamp(c.l, 0.14, 0.95) };
}
