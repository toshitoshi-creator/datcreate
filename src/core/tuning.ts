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
  },
};

export function tuningFor(version: number): Tuning {
  const t = TUNINGS[version];
  if (!t) throw new Error(`Unsupported generator version ${version}`);
  return t;
}
