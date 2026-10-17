/**
 * Per-generator-version tuning. A game keeps the generatorVersion it was
 * started with, so v1 values must never change (guarded by a fingerprint
 * test); new behaviour goes into a new version.
 */
export interface Tuning {
  version: number;
  // face planning
  facePlanMinEpoch: number;
  faceMinMain: number;
  faceMinCore: number;
  faceMinFill: number;
  eyeRadiusMin: number;
  eyeRadiusMax: number;
  /** Eye targets: vertical position scale and horizontal spread relative to the body box. */
  eyeYScale: number;
  eyeXScale: number;
  replanFactor: number;
  replanRetryFactor: number;
  /** Bright eyes get a hollow dark pupil in their centre. */
  brightPupil: boolean;
  cheeks: boolean;
  /** v2: eye whites are always near-white and eye rims slightly darker (outline). */
  crispEyes: boolean;
  /** Keep older face plans as weaker tendencies (v1) or let only the newest one count (v2). */
  keepOldPlans: boolean;
  // placement
  hollowDamp: number;
  hollowPenalty: number;
  eyeBonus: number;
  limbChance: number;
  /** Limbs may be up to this many cells thick (1 = thin tendrils). */
  limbThicknessMax: number;
  // colour
  accentBase: number;
  accentGain: number;
  sparkScale: number;
  /** Probability scale of per-dot time/weather colour shifts. */
  envColorChance: number;
  /** How strongly the core of a face-planned body is smoothed toward one colour. */
  faceColorCalm: number;
  /** Weight of 8-neighbour contact (higher = smoother outline). */
  n8Weight: number;
  /** Vertical stretch of eye zones (1 = round). */
  eyeAspect: number;
  /** Eye rim colour accents (v1/v2). */
  eyeRim: boolean;
  /** A white highlight dot at the upper-left of each eye (v3). */
  eyeShine: boolean;
  /** Scale of per-dot colour jitter. */
  colorJitter: number;
  /**
   * v3: the face is planned up-front for the body's expected size at this many
   * dots, in empty space the body has yet to grow into (0 = plan from analysis).
   */
  futureFaceAt: number;
  /** <1 applies time/weather colour shifts only partially (softer, no specks). */
  envColorBlend: number;
  /**
   * v3: facial features are colour tendencies on dots placed there (dark eyes
   * and mouth) instead of gaps, so they never obstruct growth.
   */
  paintedFace: boolean;
  /** v3: painted facial dots are discouraged until this many 8-neighbours exist (0 = off). */
  inkNeedsSupport: number;
}

export const TUNINGS: Record<number, Tuning> = {
  1: {
    version: 1,
    facePlanMinEpoch: 48,
    faceMinMain: 60,
    faceMinCore: 7,
    faceMinFill: 0.45,
    eyeRadiusMin: 0.6,
    eyeRadiusMax: 3.5,
    eyeYScale: 0.8,
    eyeXScale: 1.15,
    replanFactor: 4,
    replanRetryFactor: 2,
    brightPupil: false,
    cheeks: false,
    crispEyes: false,
    keepOldPlans: true,
    hollowDamp: 1.5,
    hollowPenalty: 14,
    eyeBonus: 1.2,
    limbChance: 0.45,
    limbThicknessMax: 1,
    accentBase: 0.3,
    accentGain: 0.7,
    sparkScale: 1,
    envColorChance: 1,
    faceColorCalm: 0,
    n8Weight: 0.2,
    eyeAspect: 1,
    eyeRim: true,
    eyeShine: false,
    colorJitter: 1,
    futureFaceAt: 0,
    envColorBlend: 1,
    paintedFace: false,
    inkNeedsSupport: 0,
  },
  2: {
    version: 2,
    facePlanMinEpoch: 32,
    faceMinMain: 36,
    faceMinCore: 6,
    faceMinFill: 0.5,
    eyeRadiusMin: 1.2,
    eyeRadiusMax: 5,
    eyeYScale: 0.75,
    eyeXScale: 1.25,
    replanFactor: 3,
    replanRetryFactor: 1.6,
    brightPupil: true,
    cheeks: true,
    crispEyes: true,
    keepOldPlans: false,
    hollowDamp: 1.6,
    hollowPenalty: 18,
    eyeBonus: 1.6,
    limbChance: 0.5,
    limbThicknessMax: 2,
    accentBase: 0.55,
    accentGain: 0.45,
    sparkScale: 0.3,
    envColorChance: 0.4,
    faceColorCalm: 0.55,
    n8Weight: 0.2,
    eyeAspect: 1,
    eyeRim: true,
    eyeShine: false,
    colorJitter: 1,
    futureFaceAt: 0,
    envColorBlend: 1,
    paintedFace: false,
    inkNeedsSupport: 0,
  },
  3: {
    version: 3,
    facePlanMinEpoch: 0,
    faceMinMain: 0,
    faceMinCore: 0,
    faceMinFill: 0,
    eyeRadiusMin: 1,
    eyeRadiusMax: 6,
    eyeYScale: 1,
    eyeXScale: 1,
    replanFactor: Infinity,
    replanRetryFactor: Infinity,
    brightPupil: false,
    cheeks: true,
    crispEyes: false,
    keepOldPlans: false,
    hollowDamp: 1.7,
    hollowPenalty: 20,
    eyeBonus: 0,
    limbChance: 0,
    limbThicknessMax: 2,
    accentBase: 0,
    accentGain: 2.2,
    sparkScale: 0,
    envColorChance: 0.6,
    faceColorCalm: 0.85,
    n8Weight: 0.45,
    eyeAspect: 1.35,
    eyeRim: false,
    eyeShine: true,
    colorJitter: 0.4,
    futureFaceAt: 500,
    envColorBlend: 0.3,
    paintedFace: true,
    inkNeedsSupport: 5,
  },
};

export function tuningFor(version: number): Tuning {
  const t = TUNINGS[version];
  if (!t) throw new Error(`Unsupported generator version ${version}`);
  return t;
}
