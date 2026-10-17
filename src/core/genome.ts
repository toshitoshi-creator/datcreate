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
}

/** A soft ellipse of the body-plan field, in units of the growing body scale. */
export interface BlobGene {
  ox: number;
  oy: number;
  rx: number;
  ry: number;
}

export type ColorPattern = 'patches' | 'stripes-h' | 'stripes-v' | 'rings' | 'plain' | 'speckle';

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
}

const DEG = Math.PI / 180;

export function deriveGenome(initialSeed: number, generatorVersion: number): Genome {
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
  };
}
