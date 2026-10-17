import { Rng, hash32 } from './rng';

/**
 * Individual traits derived deterministically from the game's initial seed.
 * They only shape *probabilities*; nothing here is a fixed final form.
 */
export interface EyeGene {
  /** Horizontal offset from body centre, as a fraction of body width. */
  dx: number;
  /** Vertical position from body top, as a fraction of body height. */
  dy: number;
  /** Radius as a fraction of min(body w, h). */
  size: number;
}

export interface LimbGene {
  /** Screen angle in radians (0 = right, PI/2 = down). */
  angle: number;
  /** Target protrusion length as a multiple of body radius. */
  length: number;
  wobble: number;
  kind: 'leg' | 'arm' | 'antenna' | 'tail';
  /** Max thickness in cells (v2+); undefined = thin tendril. */
  thickness?: number;
}

/** A soft ellipse of the body-plan field, in units of the growing body scale. */
export interface BlobGene {
  ox: number;
  oy: number;
  rx: number;
  ry: number;
}

export type ColorPattern = 'patches' | 'stripes-h' | 'stripes-v' | 'rings' | 'plain' | 'speckle' | 'belly';

/** Look chosen when the game starts (v3+). Undefined = 'cute'. */
export type CreatureStyle = 'cute' | 'cool';

export interface Genome {
  // shape
  blobs: BlobGene[];
  blobArea: number;
  cohesion: number;
  compactness: number;
  lobe: number;
  lobeScale: number;
  noiseSeed: number;
  recentParentChance: number;
  momentum: number;
  symmetry: number;
  fill: number;
  scatter: number;
  temperature: number;
  // face
  faceAffinity: number;
  /** Chance that facial tendencies are re-planned at a larger scale later in life. */
  replanChance: number;
  eyeStyle: 'hollow' | 'bright';
  eyes: EyeGene[];
  hasMouth: boolean;
  mouthY: number;
  mouthWidth: number;
  mouthCurve: number;
  mouthDx: number;
  hasNose: boolean;
  // limbs
  limbAffinity: number;
  limbs: LimbGene[];
  // colour
  hue: number;
  paletteHues: number[];
  paletteWeights: number[];
  saturation: number;
  lightness: number;
  volatility: number;
  inheritance: number;
  pattern: ColorPattern;
  patternScale: number;
  patternStrength: number;
  colorSeed: number;
  /** Faint blush accents under the eyes (v2+). */
  hasCheeks: boolean;
  cheekHue: number;
  // --- 'cool' style extras (undefined for every other genome) ---
  /** Eye zone height/width ratio, overriding the version default. */
  eyeAspect?: number;
  /** Upturned outer eye corners (cells of rise per cell outward). */
  eyeTilt?: number;
  /** Glowing iris colour instead of dark eyes. */
  irisHue?: number;
  hasFang?: boolean;
  /** A small mark on the forehead. */
  crestHue?: number;
}

const DEG = Math.PI / 180;

export function deriveGenome(initialSeed: number, generatorVersion: number, style?: CreatureStyle): Genome {
  const base = deriveBaseGenome(initialSeed, generatorVersion);
  if (generatorVersion >= 3) {
    const cute = kawaiify(base, initialSeed, generatorVersion);
    return style === 'cool' ? coolify(cute, initialSeed, generatorVersion) : cute;
  }
  return generatorVersion >= 2 ? characterize(base, initialSeed, generatorVersion) : base;
}

function deriveBaseGenome(initialSeed: number, generatorVersion: number): Genome {
  const r = new Rng(hash32(initialSeed, 'genome', generatorVersion));

  const aspect = r.chance(0.3) ? r.range(0.65, 1.5) : r.range(0.85, 1.18);

  // Body plan: soft target field made of 1-4 ellipses. Scales with size, so it
  // biases silhouettes without fixing a final form.
  const blobs: BlobGene[] = [];
  const plan = r.weighted([0.34, 0.24, 0.14, 0.16, 0.12]);
  const tilt = r.chance(0.4) ? r.range(-0.35, 0.35) : 0;
  if (plan === 0) {
    blobs.push({ ox: 0, oy: 0, rx: aspect, ry: 1 / aspect });
  } else if (plan === 1) {
    // head over body
    const hr = r.range(0.55, 0.9);
    blobs.push({ ox: 0, oy: 0, rx: r.range(0.8, 1.2), ry: r.range(0.75, 1.1) });
    blobs.push({ ox: tilt, oy: -r.range(0.9, 1.4), rx: hr * r.range(0.9, 1.3), ry: hr });
  } else if (plan === 2) {
    // worm / horizontal segments
    const k = 2 + r.int(3);
    const dir = r.chance(0.5) ? 1 : -1;
    for (let i = 0; i < k; i++) {
      blobs.push({ ox: dir * i * r.range(0.7, 1.0), oy: Math.sin(i * 1.3 + tilt * 5) * r.range(0, 0.45), rx: r.range(0.5, 0.8), ry: r.range(0.45, 0.75) });
    }
  } else if (plan === 3) {
    // lopsided twin lobes
    blobs.push({ ox: 0, oy: 0, rx: r.range(0.7, 1.0), ry: r.range(0.7, 1.0) });
    const side = r.chance(0.5) ? 1 : -1;
    blobs.push({ ox: side * r.range(0.6, 1.1), oy: r.range(-0.7, 0.5), rx: r.range(0.35, 0.7), ry: r.range(0.35, 0.7) });
  } else {
    // tall body
    blobs.push({ ox: 0, oy: 0, rx: r.range(0.45, 0.7), ry: r.range(1.1, 1.6) });
    if (r.chance(0.5)) blobs.push({ ox: tilt, oy: -r.range(0.9, 1.3), rx: r.range(0.5, 0.75), ry: r.range(0.4, 0.6) });
  }
  let blobArea = 0;
  for (const b of blobs) blobArea += b.rx * b.ry;

  // Face genes ---------------------------------------------------------
  const faceAffinity = r.chance(0.22) ? r.range(0, 0.08) : r.range(0.45, 1);
  const eyeCount = [2, 1, 3, 4, 0][r.weighted([0.6, 0.15, 0.14, 0.05, 0.06])];
  const eyes: EyeGene[] = [];
  const sep = r.range(0.15, 0.3);
  const baseY = r.range(0.26, 0.42);
  const size = r.range(0.06, 0.13);
  const asym = r.chance(0.35) ? r.range(0.04, 0.12) : r.range(0, 0.03);
  if (eyeCount === 1) {
    eyes.push({ dx: r.range(-0.18, 0.18), dy: baseY + r.range(-0.05, 0.05), size: size * r.range(1.1, 1.6) });
  } else if (eyeCount === 2) {
    eyes.push({ dx: -sep + r.range(-asym, asym), dy: baseY + r.range(-asym, asym), size: size * r.range(0.8, 1.2) });
    eyes.push({ dx: sep + r.range(-asym, asym), dy: baseY + r.range(-asym, asym), size: size * r.range(0.8, 1.2) });
  } else if (eyeCount >= 3) {
    for (let i = 0; i < eyeCount; i++) {
      const t = eyeCount === 1 ? 0 : i / (eyeCount - 1) - 0.5;
      eyes.push({
        dx: t * sep * 2.6 + r.range(-asym, asym),
        dy: baseY + (r.chance(0.5) ? Math.abs(t) * 0.1 : -Math.abs(t) * 0.12) + r.range(-0.04, 0.04),
        size: size * r.range(0.6, 1.1),
      });
    }
  }

  // Limb genes ----------------------------------------------------------
  const limbAffinity = r.chance(0.25) ? r.range(0, 0.08) : r.range(0.35, 1);
  const limbs: LimbGene[] = [];
  const limbPlan = r.weighted([0.12, 0.3, 0.22, 0.14, 0.12, 0.1]);
  const addPair = (kind: LimbGene['kind'], centre: number, spread: number, length: number) => {
    const jitter = r.chance(0.5) ? r.range(5, 18) : r.range(0, 5);
    limbs.push({ kind, angle: (centre - spread + r.range(-jitter, jitter)) * DEG, length: length * r.range(0.75, 1.25), wobble: r.range(0, 0.5) });
    limbs.push({ kind, angle: (centre + spread + r.range(-jitter, jitter)) * DEG, length: length * r.range(0.75, 1.25), wobble: r.range(0, 0.5) });
  };
  if (limbPlan === 1 || limbPlan === 3 || limbPlan === 5) addPair('leg', 90, r.range(14, 38), r.range(0.6, 1.8));
  if (limbPlan === 2 || limbPlan === 3) {
    const a = r.range(-25, 25);
    limbs.push({ kind: 'arm', angle: (180 + a + r.range(-12, 12)) * DEG, length: r.range(0.5, 1.6), wobble: r.range(0, 0.6) });
    limbs.push({ kind: 'arm', angle: (-a + r.range(-12, 12)) * DEG, length: r.range(0.5, 1.6), wobble: r.range(0, 0.6) });
  }
  if (limbPlan === 4) {
    const k = 3 + r.int(4); // radial tentacles
    const off = r.range(0, 360);
    for (let i = 0; i < k; i++) {
      limbs.push({ kind: 'tail', angle: (off + (360 / k) * i + r.range(-15, 15)) * DEG, length: r.range(0.6, 2.2), wobble: r.range(0.2, 0.8) });
    }
  }
  if (limbPlan === 5 || r.chance(0.15)) addPair('antenna', -90, r.range(10, 35), r.range(0.4, 1.1));
  if (r.chance(0.12)) limbs.push({ kind: 'tail', angle: r.range(0, 360) * DEG, length: r.range(0.6, 1.8), wobble: r.range(0.2, 0.9) });

  // Colour genes --------------------------------------------------------
  const hue = r.range(0, 360);
  const scheme = r.weighted([0.35, 0.25, 0.2, 0.2]);
  const offsets =
    scheme === 0 ? [0, r.range(18, 40), -r.range(18, 40)] // analogous
    : scheme === 1 ? [0, 180 + r.range(-20, 20), r.range(10, 30)] // complementary
    : scheme === 2 ? [0, 120 + r.range(-10, 10), 240 + r.range(-10, 10)] // triadic
    : [0, r.range(5, 15), r.range(150, 210)]; // mono + accent
  const paletteHues = offsets.map((o) => (hue + o + 360) % 360);
  const paletteWeights = [1, r.range(0.25, 0.7), r.range(0.1, 0.45)];

  const pattern = (['patches', 'stripes-h', 'stripes-v', 'rings', 'plain', 'speckle'] as const)[r.weighted([0.34, 0.12, 0.1, 0.14, 0.18, 0.12])];

  return {
    blobs,
    blobArea,
    cohesion: r.range(0.55, 1.35),
    compactness: r.range(0.5, 1.6),
    lobe: r.range(0.5, 1.6),
    lobeScale: r.range(3.5, 9),
    noiseSeed: hash32(initialSeed, 'noise', generatorVersion),
    recentParentChance: r.range(0.2, 0.6),
    momentum: r.range(0, 1.3),
    symmetry: r.chance(0.25) ? r.range(0, 0.15) : r.range(0.3, 1.3),
    fill: r.range(0.3, 1.6),
    scatter: r.chance(0.18) ? r.range(0.5, 1) : r.range(0, 0.3),
    temperature: r.range(0.6, 1.1),
    faceAffinity,
    eyeStyle: r.chance(0.7) ? 'hollow' : 'bright',
    eyes,
    hasMouth: r.chance(0.78),
    mouthY: r.range(0.6, 0.8),
    mouthWidth: r.range(0.18, 0.48),
    mouthCurve: r.range(-1, 1),
    mouthDx: r.range(-0.08, 0.08),
    hasNose: r.chance(0.5),
    limbAffinity,
    limbs,
    hue,
    paletteHues,
    paletteWeights,
    saturation: r.chance(0.2) ? r.range(0.12, 0.35) : r.range(0.35, 0.75),
    lightness: r.range(0.45, 0.66),
    volatility: r.range(0.02, 0.2),
    inheritance: r.range(0.8, 0.95),
    pattern,
    patternScale: r.range(2, 6),
    patternStrength: r.range(0.25, 0.65),
    colorSeed: hash32(initialSeed, 'colour', generatorVersion),
    replanChance: r.range(0.3, 0.9),
    hasCheeks: false,
    cheekHue: 0,
  };
}

/**
 * v2: nudges the genome toward readable "character" silhouettes — compact
 * bodies (often a head over a body), calmer colours, larger eyes and stubby
 * limbs — while keeping variety and a share of abstract individuals. These are
 * still only probabilities for future growth.
 */
function characterize(g: Genome, initialSeed: number, generatorVersion: number): Genome {
  const r = new Rng(hash32(initialSeed, 'character', generatorVersion));
  const out: Genome = { ...g };

  // silhouette ------------------------------------------------------------
  const plan = r.weighted([0.34, 0.36, 0.15, 0.08, 0.07]);
  const tilt = r.chance(0.25) ? r.range(-0.2, 0.2) : 0;
  const blobs: BlobGene[] = [];
  if (plan === 0) {
    const a = r.range(0.88, 1.25);
    blobs.push({ ox: 0, oy: 0, rx: a, ry: 1 / a });
  } else if (plan === 1) {
    // big head, smaller body (chibi proportions)
    const hr = r.range(0.85, 1.15);
    blobs.push({ ox: 0, oy: 0, rx: hr * r.range(1, 1.2), ry: hr });
    blobs.push({ ox: tilt, oy: r.range(1.0, 1.35), rx: r.range(0.55, 0.85), ry: r.range(0.5, 0.75) });
  } else if (plan === 2) {
    blobs.push({ ox: 0, oy: 0, rx: r.range(1.2, 1.5), ry: r.range(0.7, 0.9) });
  } else if (plan === 3) {
    blobs.push({ ox: 0, oy: 0, rx: r.range(0.8, 1.0), ry: r.range(0.8, 1.0) });
    blobs.push({ ox: (r.chance(0.5) ? 1 : -1) * r.range(0.6, 0.9), oy: r.range(-0.4, 0.4), rx: r.range(0.4, 0.6), ry: r.range(0.4, 0.6) });
  } else {
    blobs.push({ ox: 0, oy: 0, rx: r.range(0.6, 0.8), ry: r.range(1.15, 1.45) });
  }
  out.blobs = blobs;
  out.blobArea = blobs.reduce((s, b) => s + b.rx * b.ry, 0);
  out.lobe = g.lobe * 0.45;
  out.lobeScale = r.range(6, 11);
  out.compactness = r.range(1.1, 1.8);
  out.cohesion = r.range(0.9, 1.4);
  out.scatter = r.chance(0.08) ? r.range(0.3, 0.6) : r.range(0, 0.08);
  out.fill = r.range(0.8, 1.6);
  out.momentum = r.range(0, 0.5);
  out.symmetry = r.chance(0.15) ? r.range(0.1, 0.4) : r.range(0.7, 1.4);
  out.temperature = r.range(0.55, 0.85);

  // face --------------------------------------------------------------------
  out.faceAffinity = r.chance(0.12) ? r.range(0, 0.08) : r.range(0.65, 1);
  out.eyeStyle = r.chance(0.5) ? 'bright' : 'hollow';
  const headTop = plan === 1; // face sits on the head blob, i.e. higher up
  const eyeCount = [2, 1, 3][r.weighted([0.8, 0.12, 0.08])];
  const sep = r.range(0.17, 0.27);
  const baseY = headTop ? r.range(0.17, 0.27) : r.range(0.3, 0.42);
  const size = r.range(0.13, 0.2);
  const asym = r.chance(0.25) ? r.range(0.03, 0.08) : r.range(0, 0.015);
  out.eyes = [];
  if (eyeCount === 1) out.eyes.push({ dx: r.range(-0.05, 0.05), dy: baseY, size: size * r.range(1.3, 1.7) });
  else {
    for (let i = 0; i < eyeCount; i++) {
      const t = i / (eyeCount - 1) - 0.5;
      out.eyes.push({ dx: t * 2 * sep + r.range(-asym, asym), dy: baseY + (eyeCount === 3 && i === 1 ? -0.07 : 0) + r.range(-asym, asym), size: size * r.range(0.9, 1.1) });
    }
  }
  out.hasMouth = r.chance(0.88);
  out.mouthY = headTop ? r.range(0.4, 0.5) : r.range(0.6, 0.72);
  out.mouthWidth = r.range(0.22, 0.42);
  out.mouthCurve = r.chance(0.7) ? r.range(0.3, 1) : r.range(-0.8, 0.2);
  out.mouthDx = r.range(-0.03, 0.03);
  out.hasNose = r.chance(0.3);
  out.hasCheeks = r.chance(0.4);
  out.cheekHue = r.range(330, 375) % 360;
  out.replanChance = r.range(0.65, 0.95);

  // limbs: stubby, thicker, mostly legs ---------------------------------------
  out.limbAffinity = r.chance(0.18) ? r.range(0, 0.05) : r.range(0.5, 1);
  const limbs: LimbGene[] = [];
  const lp = r.weighted([0.2, 0.36, 0.24, 0.1, 0.1]);
  const pair = (kind: LimbGene['kind'], centre: number, spread: number, len: number, thick: number) => {
    const j = r.range(0, 6);
    for (const sgn of [-1, 1]) {
      limbs.push({ kind, angle: (centre + sgn * spread + r.range(-j, j)) * DEG, length: len * r.range(0.9, 1.1), wobble: r.range(0, 0.15), thickness: thick });
    }
  };
  const legThick = r.chance(0.6) ? 2 : 1;
  if (lp === 1 || lp === 2 || lp === 4) pair('leg', 90, r.range(18, 34), r.range(0.4, 0.85), legThick);
  if (lp === 2 || lp === 3) {
    const droop = r.range(0, 35);
    limbs.push({ kind: 'arm', angle: (180 - droop) * DEG, length: r.range(0.35, 0.75), wobble: r.range(0, 0.2), thickness: r.chance(0.4) ? 2 : 1 });
    limbs.push({ kind: 'arm', angle: droop * DEG, length: limbs[limbs.length - 1].length, wobble: r.range(0, 0.2), thickness: limbs[limbs.length - 1].thickness });
  }
  if (lp === 4) pair('antenna', -90, r.range(12, 30), r.range(0.3, 0.6), 1);
  if (r.chance(0.08)) limbs.push({ kind: 'tail', angle: (r.chance(0.5) ? r.range(120, 160) : r.range(20, 60)) * DEG, length: r.range(0.4, 0.9), wobble: r.range(0.1, 0.4), thickness: 1 });
  out.limbs = limbs;

  // colour: calmer, more coherent ------------------------------------------------
  out.volatility = g.volatility * 0.35;
  out.inheritance = r.range(0.9, 0.97);
  out.pattern = (['patches', 'plain', 'rings', 'stripes-h', 'speckle'] as const)[r.weighted([0.34, 0.36, 0.1, 0.12, 0.08])];
  out.patternScale = r.range(4, 9);
  out.patternStrength = r.range(0.15, 0.4);
  out.saturation = r.chance(0.12) ? r.range(0.15, 0.35) : r.range(0.45, 0.8);
  out.lightness = r.range(0.5, 0.68);
  return out;
}

/**
 * v3: "kawaii" tendencies. Round / mochi-like bodies; ears and feet appear as
 * small soft lobes of the body-plan field (so they grow rounded, never as thin
 * tendrils); pastel, nearly flat colour; big wide-set eyes, a small smile and
 * cheeks. In v3 eye/mouth genes are in units of the planned body size:
 * dx = fraction of the half-width, dy = fraction of the half-height from the
 * body centre. Still only probabilities — about 1 in 10 individuals carries
 * no facial tendency at all.
 */
function kawaiify(g: Genome, initialSeed: number, generatorVersion: number): Genome {
  const r = new Rng(hash32(initialSeed, 'kawaii', generatorVersion));
  const out: Genome = { ...g };

  const body = r.weighted([0.45, 0.33, 0.22]);
  const blobs: BlobGene[] = [];
  if (body === 0) blobs.push({ ox: 0, oy: 0, rx: r.range(1.0, 1.1), ry: r.range(0.9, 1.0) });
  else if (body === 1) blobs.push({ ox: 0, oy: 0, rx: r.range(1.15, 1.35), ry: r.range(0.78, 0.9) }); // mochi
  else {
    blobs.push({ ox: 0, oy: 0, rx: r.range(1.0, 1.1), ry: r.range(0.88, 0.98) }); // head
    blobs.push({ ox: 0, oy: r.range(0.95, 1.05), rx: r.range(0.6, 0.72), ry: r.range(0.42, 0.55) }); // little body
  }
  const head = blobs[0];
  const bottom = blobs[blobs.length - 1];
  if (r.chance(0.55)) {
    if (r.chance(0.75)) {
      // round / cat-like ears
      const ex = head.rx * r.range(0.5, 0.65), er = r.range(0.2, 0.28);
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * ex, oy: -head.ry * r.range(0.82, 0.92), rx: er, ry: er * r.range(0.9, 1.2) });
    } else {
      // long bunny ears
      const ex = head.rx * r.range(0.28, 0.4);
      for (const sgn of [-1, 1]) blobs.push({ ox: sgn * ex, oy: -head.ry * r.range(1.15, 1.3), rx: r.range(0.13, 0.18), ry: r.range(0.38, 0.5) });
    }
  }
  if (r.chance(0.7)) {
    const fx = bottom.rx * r.range(0.4, 0.55), fr = r.range(0.2, 0.27);
    for (const sgn of [-1, 1]) blobs.push({ ox: sgn * fx, oy: bottom.oy + bottom.ry * 0.9, rx: fr * 1.15, ry: fr * 0.8 });
  }
  if (r.chance(0.12)) blobs.push({ ox: (r.chance(0.5) ? 1 : -1) * (bottom.rx + 0.1), oy: bottom.oy + 0.25, rx: 0.2, ry: 0.18 });
  out.blobs = blobs;
  out.blobArea = blobs.reduce((sum, b) => sum + b.rx * b.ry, 0);

  // smooth, solid, calm growth
  out.lobe = r.range(0.05, 0.2);
  out.lobeScale = r.range(9, 14);
  out.compactness = r.range(1.9, 2.5);
  out.cohesion = r.range(1.2, 1.5);
  out.scatter = 0;
  out.fill = r.range(1.5, 2.1);
  out.momentum = r.range(0, 0.2);
  out.recentParentChance = r.range(0.2, 0.35);
  out.symmetry = r.chance(0.12) ? r.range(0.4, 0.8) : r.range(1.2, 1.8);
  out.temperature = r.range(0.4, 0.55);
  out.limbs = [];
  out.limbAffinity = 0;

  // face
  out.faceAffinity = r.chance(0.1) ? r.range(0, 0.05) : r.range(0.8, 1);
  out.eyeStyle = 'hollow';
  const sep = r.range(0.36, 0.46);
  const ey = body === 2 ? r.range(-0.05, 0.12) : r.range(0.0, 0.18);
  const size = r.range(0.14, 0.18);
  const tilt = r.chance(0.2) ? r.range(-0.06, 0.06) : 0; // slight, charming asymmetry
  out.eyes = [{ dx: -sep, dy: ey + tilt, size }, { dx: sep, dy: ey - tilt, size }];
  out.hasMouth = r.chance(0.85);
  out.mouthY = ey + r.range(0.3, 0.4);
  out.mouthWidth = r.range(0.1, 0.17);
  out.mouthCurve = r.range(0.4, 1);
  out.mouthDx = 0;
  out.hasNose = false;
  out.hasCheeks = r.chance(0.85);
  out.cheekHue = r.range(340, 360) % 360;

  // pastel, nearly flat colour
  const hue = r.range(0, 360);
  out.hue = hue;
  out.paletteHues = [hue, (hue + r.range(8, 16)) % 360, (hue + 360 - r.range(8, 16)) % 360];
  out.paletteWeights = [1, 0.3, 0.3];
  out.saturation = r.chance(0.1) ? r.range(0.12, 0.25) : r.range(0.35, 0.6);
  out.lightness = r.range(0.7, 0.8);
  out.pattern = r.chance(0.75) ? 'plain' : 'patches';
  out.patternScale = r.range(8, 12);
  out.patternStrength = r.range(0.08, 0.18);
  out.volatility = 0.005;
  out.inheritance = 0.97;
  return out;
}

/**
 * v3 'cool' style (かっこかわいい): keeps the smooth, round growth of the cute
 * genome but with pointed ears, optional horns and a curled tail, deeper cool
 * body colours (often a lighter belly), narrower upturned glowing eyes, a
 * small fang and sometimes a forehead mark. Uses its own random stream, so
 * the cute genome is unaffected.
 */
function coolify(g: Genome, initialSeed: number, generatorVersion: number): Genome {
  const r = new Rng(hash32(initialSeed, 'cool', generatorVersion));
  const out: Genome = { ...g };

  const body = r.weighted([0.3, 0.2, 0.5]);
  const blobs: BlobGene[] = [];
  if (body === 0) blobs.push({ ox: 0, oy: 0, rx: r.range(0.95, 1.05), ry: r.range(0.92, 1.0) });
  else if (body === 1) blobs.push({ ox: 0, oy: 0, rx: r.range(1.1, 1.25), ry: r.range(0.8, 0.9) });
  else {
    blobs.push({ ox: 0, oy: 0, rx: r.range(1.0, 1.08), ry: r.range(0.88, 0.96) });
    blobs.push({ ox: 0, oy: r.range(0.95, 1.05), rx: r.range(0.62, 0.72), ry: r.range(0.5, 0.6) });
  }
  const head = blobs[0];
  const bottom = blobs[blobs.length - 1];
  if (r.chance(0.85)) {
    // pointed ears: a tall narrow lobe topped by a smaller one
    const ex = head.rx * r.range(0.55, 0.68);
    const h = r.range(0.32, 0.42);
    for (const sgn of [-1, 1]) {
      blobs.push({ ox: sgn * ex, oy: -head.ry * r.range(0.86, 0.94), rx: r.range(0.13, 0.17), ry: h });
      blobs.push({ ox: sgn * (ex + 0.06), oy: -head.ry * 0.92 - h * 0.9, rx: 0.07, ry: 0.15 });
    }
  }
  if (r.chance(0.3)) {
    for (const sgn of [-1, 1]) {
      blobs.push({ ox: sgn * head.rx * 0.3, oy: -head.ry * 0.95, rx: 0.1, ry: 0.14 });
      blobs.push({ ox: sgn * head.rx * 0.4, oy: -head.ry * 1.12, rx: 0.07, ry: 0.1 });
    }
  }
  if (r.chance(0.7)) {
    const fx = bottom.rx * r.range(0.4, 0.55), fr = r.range(0.2, 0.26);
    for (const sgn of [-1, 1]) blobs.push({ ox: sgn * fx, oy: bottom.oy + bottom.ry * 0.9, rx: fr * 1.15, ry: fr * 0.8 });
  }
  if (r.chance(0.55)) {
    // a tail curling upward
    const side = r.chance(0.5) ? 1 : -1;
    blobs.push({ ox: side * (bottom.rx + 0.08), oy: bottom.oy + 0.2, rx: 0.2, ry: 0.12 });
    blobs.push({ ox: side * (bottom.rx + 0.3), oy: bottom.oy + 0.02, rx: 0.12, ry: 0.12 });
    blobs.push({ ox: side * (bottom.rx + 0.4), oy: bottom.oy - 0.16, rx: 0.1, ry: 0.13 });
  }
  out.blobs = blobs;
  out.blobArea = blobs.reduce((sum, b) => sum + b.rx * b.ry, 0);

  // face: narrower, upturned, glowing eyes; small mouth with a fang
  const sep = r.range(0.34, 0.42);
  const ey = body === 2 ? r.range(-0.02, 0.1) : r.range(0.0, 0.12);
  const size = r.range(0.17, 0.21);
  out.eyes = [{ dx: -sep, dy: ey, size }, { dx: sep, dy: ey, size }];
  out.eyeAspect = r.range(0.78, 0.9);
  out.eyeTilt = r.range(0.22, 0.36);
  out.irisHue = [48, 188, 355, 100, 280][r.weighted([0.32, 0.26, 0.2, 0.12, 0.1])] + r.range(-6, 6);
  out.hasMouth = r.chance(0.85);
  out.mouthY = ey + r.range(0.3, 0.36);
  out.mouthWidth = r.range(0.07, 0.11);
  out.mouthCurve = r.range(0, 0.35);
  out.hasFang = r.chance(0.65);
  out.hasCheeks = r.chance(0.15);
  out.crestHue = r.chance(0.35) ? (r.chance(0.5) ? out.irisHue : r.range(40, 55)) : undefined;

  // deeper, cooler colours
  const fam = r.weighted([0.34, 0.2, 0.2, 0.14, 0.12]);
  const hue = fam === 0 ? r.range(215, 250) : fam === 1 ? r.range(258, 285) : fam === 2 ? r.range(172, 196) : fam === 3 ? r.range(220, 240) : r.range(345, 360) % 360;
  out.hue = hue;
  out.paletteHues = [hue, (hue + r.range(6, 12)) % 360, (hue + 360 - r.range(6, 12)) % 360];
  out.saturation = fam === 3 ? r.range(0.06, 0.14) : r.range(0.3, 0.55);
  out.lightness = fam === 3 ? r.range(0.27, 0.34) : r.range(0.32, 0.44);
  out.pattern = (['belly', 'plain', 'patches'] as const)[r.weighted([0.45, 0.4, 0.15])];
  out.patternStrength = r.range(0.06, 0.1); // dark bodies show mottling easily
  out.patternScale = r.range(10, 14);
  return out;
}
