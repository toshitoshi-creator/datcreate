import {
  FACE_PLAN_MAX_EPOCH,
  FACE_REPLAN_MAX_EPOCH,
  analyzeShape,
  buildFacePlan,
  buildFuturePlan,
  canPlanFace,
  earlyFaceZones,
  epochAtOrBefore,
  nextEpochAfter,
  smoothstep,
  type FaceZones,
  type FacePlan,
  type ShapeAnalysis,
} from './analysis';
import { generateColor } from './colorGen';
import { hslToHex } from './color';
import { envEffect } from './environment';
import { deriveGenome, type Genome } from './genome';
import { GrowthModel, N8, cellKey, keyToXY, type CellInfo } from './model';
import { noise2 } from './noise';
import { Rng, hash32 } from './rng';
import { tuningFor, type Tuning } from './tuning';
import type { EnvUsed, GameState, Pixel } from './types';

export interface SlotInput {
  growthIndex: number;
  /** Scheduled time of the slot. */
  createdAt: number;
  env: EnvUsed;
  environmentSnapshotId: string | null;
}

export type GameIdentity = Pick<GameState, 'gameId' | 'initialSeed' | 'generatorVersion' | 'style' | 'species'>;

interface GeneratorContext {
  game: GameIdentity;
  tuning: Tuning;
  /** Face zones to use while no analysis exists yet (species only). */
  earlyFace?: FaceZones | null;
  genome: Genome;
  model: GrowthModel;
  analysis: ShapeAnalysis | null;
  slot: SlotInput;
}

export const pixelSeed = (initialSeed: number, growthIndex: number, generatorVersion: number) =>
  hash32(initialSeed, growthIndex, generatorVersion);

function makePixel(ctx: GeneratorContext, x: number, y: number, parent: CellInfo | null, rng: Rng, seed: number): Pixel {
  const { game, genome, model, analysis, slot, tuning } = ctx;
  const k = cellKey(x, y);
  const face = analysis?.face ?? ctx.earlyFace ?? null;
  const inFace = !!face && x >= face.box.x0 && x <= face.box.x1 && y >= face.box.y0 && y <= face.box.y1;
  const skip = face && tuning.paintedFace
    ? (nx: number, ny: number) => face.accent.has(cellKey(nx, ny))
    : undefined;
  const faceStrength = face ? (genome.firmFace ? genome.faceAffinity : face.strength) : 0;
  const hsl = generateColor(rng, model, x, y, genome, slot.env, face?.accent.get(k), faceStrength, tuning, inFace, skip, face?.markColor.get(k));
  return {
    id: `${game.gameId}:${slot.growthIndex}`,
    gameId: game.gameId,
    growthIndex: slot.growthIndex,
    x,
    y,
    color: hslToHex(hsl),
    createdAt: slot.createdAt,
    parentId: parent ? parent.id : null,
    seed,
    environmentSnapshotId: slot.environmentSnapshotId,
    generatorVersion: game.generatorVersion,
    envUsed: slot.env,
  };
}

interface Cand {
  x: number;
  y: number;
  k: number;
  parent: CellInfo;
}

/**
 * The growth step. Pure: same (game, pixels so far, slot) => same pixel.
 * Version differences live entirely in the Tuning table and the genome.
 */
function generate(ctx: GeneratorContext): Pixel {
  const { game, genome, model, analysis, slot, tuning: t } = ctx;
  const seed = pixelSeed(game.initialSeed, slot.growthIndex, game.generatorVersion);
  const rng = new Rng(seed);
  const n = model.size;
  if (n === 0) return makePixel(ctx, 0, 0, null, rng, seed);

  const env = slot.env;
  const ew = env.environmentInfluence;
  const ob = env.organicShapeBias;
  const eff = envEffect(env.timeOfDay, env.weather);
  const { x: cx, y: cy } = model.centroid();
  const Rb = Math.sqrt((n + 1) / (Math.PI * genome.blobArea)) + 0.5;
  /** Normalised distance to the body-plan field (1 = on its soft edge). */
  const planDist = (x: number, y: number) => {
    let best = Infinity;
    for (const b of genome.blobs) {
      const d = Math.hypot((x - b.ox * Rb) / (b.rx * Rb), (y - b.oy * Rb) / (b.ry * Rb));
      if (d < best) best = d;
    }
    return best;
  };
  const face = analysis?.face ?? ctx.earlyFace ?? null;
  const axisX = analysis ? analysis.axisX : Math.round(cx * 2) / 2;

  // Recent growth direction (momentum) ----------------------------------
  let rdx = 0, rdy = 0;
  for (let i = Math.max(0, n - 12); i < n; i++) {
    const c = model.list[i];
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > 0) { rdx += (c.x - cx) / d; rdy += (c.y - cy) / d; }
  }
  const rl = Math.hypot(rdx, rdy);
  if (rl > 0) { rdx /= rl; rdy /= rl; }

  const cands: Cand[] = [];
  const seen = new Set<number>();
  const consider = (x: number, y: number, parent: CellInfo) => {
    const k = cellKey(x, y);
    if (seen.has(k) || model.cells.has(k)) return;
    seen.add(k);
    cands.push({ x, y, k, parent });
  };

  // 1. Choose origin: a limb tip (weak bias) or an existing dot -----------
  let limbTip: CellInfo | null = null;
  let limbDirX = 0, limbDirY = 0;
  let limbThick = 1;
  const limbRoll = rng.next();
  if (analysis && analysis.limbs.length && ob > 0) {
    const p = ob * genome.limbAffinity * smoothstep(60, 400, n) * t.limbChance;
    const needy = analysis.limbs.filter((l) => l.protrusion < l.target);
    if (limbRoll < p && needy.length) {
      const limb = needy[rng.int(needy.length)];
      let tip = model.get(limb.tipX, limb.tipY) ?? null;
      let best = limb.tipProj;
      const acx = analysis.centroid.x, acy = analysis.centroid.y;
      for (let i = Math.max(0, n - 64); i < n; i++) {
        const c = model.list[i];
        const rx = c.x - acx, ry = c.y - acy;
        const proj = rx * limb.dirX + ry * limb.dirY;
        if (proj <= best) continue;
        if (Math.abs(rx * limb.dirY - ry * limb.dirX) <= 1.5 + Math.max(0, proj) * 0.18) { best = proj; tip = c; }
      }
      if (tip) {
        const a = limb.gene.angle + Math.sin(n * 0.37 + limb.gene.angle * 3) * limb.gene.wobble * 0.6;
        limbDirX = Math.cos(a);
        limbDirY = Math.sin(a);
        for (const [dx, dy] of N8) consider(tip.x + dx, tip.y + dy, tip);
        if (cands.length) {
          limbTip = tip;
          limbThick = Math.min(t.limbThicknessMax, limb.gene.thickness ?? 1);
        }
      }
    }
  }

  if (!limbTip) {
    const parent = rng.chance(genome.recentParentChance)
      ? model.list[n - 1 - rng.int(Math.min(n, 24))]
      : model.list[rng.int(n)];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) consider(parent.x + dx, parent.y + dy, parent);
    const picks = Math.min(model.frontier.length, 6);
    for (let i = 0; i < picks; i++) {
      const [fx, fy] = keyToXY(model.frontier[rng.int(model.frontier.length)]);
      for (const [dx, dy] of N8) {
        const p = model.get(fx + dx, fy + dy);
        if (p) { consider(fx, fy, p); break; }
      }
    }
  }

  // 2-4. Score candidates ------------------------------------------------
  const scores: number[] = new Array(cands.length);
  let maxS = -Infinity;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const n4 = model.n4(c.x, c.y);
    const n8 = model.n8(c.x, c.y);
    let s: number;
    if (limbTip) {
      const vx = c.x - limbTip.x, vy = c.y - limbTip.y;
      const len = Math.hypot(vx, vy) || 1;
      // thick limbs tolerate more neighbours, so the line grows two cells wide
      const align = (vx * limbDirX + vy * limbDirY) / len;
      s = limbThick >= 2
        // thick limbs: weaker pull forward, reward filling in beside the line
        ? 1.6 * align - 0.9 * Math.max(0, n8 - 4) + (n4 >= 2 ? 0.9 : 0)
        : 2.6 * align - 0.9 * Math.max(0, n8 - 1);
      s += 0.4 * noise2(genome.noiseSeed, c.x, c.y, genome.lobeScale);
    } else {
      const dx = c.x - cx, dy = c.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist, uy = dy / dist;
      const ad = planDist(c.x, c.y);
      // Adhesion saturates so enclosed gaps are attractive but not overwhelmingly so.
      const adhesion = n4 >= 2 ? 1.6 + 0.3 * (n4 - 2) : n4 * 0.8;
      s = (genome.cohesion + ew * eff.cohesion) * adhesion + t.n8Weight * n8;
      if (n8 === 0) s -= Math.max(0.3, 3 - 2.5 * (genome.scatter + ew * eff.scatter));
      s -= genome.compactness * Math.max(0, ad - 0.85) * 2.6;
      s += genome.lobe * noise2(genome.noiseSeed, c.x, c.y, genome.lobeScale);
      s += genome.momentum * (ux * rdx + uy * rdy) * 0.8;
      if (model.has(2 * axisX - c.x, c.y)) s += genome.symmetry;
      if (n4 >= 3) s += genome.fill + ew * eff.fill;
      s += ew * (eff.outward * Math.min(1, ad) + eff.down * uy + eff.horizontal * Math.abs(ux));
    }
    if (face) {
      const h = face.hollow.get(c.k);
      if (h) {
        // Discourage (never forbid) filling facial gaps: damp attraction, then penalise.
        const b = ob * h;
        s = s * (1 - Math.min(0.95, b * t.hollowDamp)) - b * t.hollowPenalty;
      }
      const a = face.accent.get(c.k);
      if (a === 'eye') s += ob * face.strength * t.eyeBonus;
      else if (a === 'nose') s += ob * face.strength * 0.8;
      // painted features wait for support so they form inside the body, not on its edge
      if (t.inkNeedsSupport && (a === 'ink' || a === 'shine' || a === 'cheek' || a === 'mouth' || a === 'fang' || a === 'crest' || a === 'markDot') && n8 < t.inkNeedsSupport && !face.enclosed.has(c.k)) s -= ob * face.strength * 8;

    }
    s += rng.next() * 0.05;
    scores[i] = s;
    if (s > maxS) maxS = s;
  }

  // 5. Sample from a softmax distribution (never plain argmax) ------------
  const T = limbTip ? 0.5 : Math.max(0.25, genome.temperature * (1 + ew * eff.temperature));
  const weights = scores.map((s) => Math.exp((s - maxS) / T));
  const chosen = cands[rng.weighted(weights)];
  return makePixel(ctx, chosen.x, chosen.y, chosen.parent, rng, seed);
}

type GeneratorFn = (ctx: GeneratorContext) => Pixel;

/**
 * Registry of generator versions. Existing pixels are never regenerated; a
 * future version only applies to games whose generatorVersion selects it.
 */
export const GENERATORS: Record<number, GeneratorFn> = { 1: generate, 2: generate, 3: generate };

export function isSupportedGenerator(version: number): boolean {
  return Object.prototype.hasOwnProperty.call(GENERATORS, version);
}

/**
 * Replays an individual and generates subsequent slots. All derived state
 * (model, analysis) is a pure function of the persisted pixels.
 */
export class Simulation {
  readonly model: GrowthModel;
  readonly genome: Genome;
  readonly tuning: Tuning;
  private analysis: ShapeAnalysis | null = null;
  private analysisEpoch = -1;
  /** Facial tendency plans decided so far (oldest first). */
  private readonly facePlans: FacePlan[] = [];
  private facePlanDone = false;
  private facePlanCheckedEpoch = -1;
  private nextReplanAt = Infinity;

  constructor(readonly game: GameIdentity, pixels: readonly Pixel[] = []) {
    if (!isSupportedGenerator(game.generatorVersion)) {
      throw new Error(`Unsupported generator version ${game.generatorVersion}`);
    }
    this.genome = deriveGenome(game.initialSeed, game.generatorVersion, game.style, game.species);
    this.tuning = tuningFor(game.generatorVersion);
    if (this.tuning.futureFaceAt > 0) {
      // v3: the facial plan depends only on the genome, so it is fixed up-front.
      const plan = buildFuturePlan(this.genome, this.tuning);
      if (plan) this.facePlans.push(plan);
      this.facePlanDone = true;
    }
    this.model = GrowthModel.fromPixels(pixels);
    // Re-derive face plans exactly as they were decided during growth.
    for (let e = nextEpochAfter(0); e < this.model.size && !this.facePlanDone; e = nextEpochAfter(e)) {
      if (this.needsPlanAttempt(e)) this.considerFacePlan(e, analyzeShape(this.model.list, e, this.genome));
    }
  }

  get nextIndex(): number {
    return this.model.size;
  }

  get plans(): readonly FacePlan[] {
    return this.facePlans;
  }

  private needsPlanAttempt(epoch: number): boolean {
    if (this.facePlanDone || epoch <= this.facePlanCheckedEpoch) return false;
    return this.facePlans.length === 0 ? epoch >= this.tuning.facePlanMinEpoch : epoch >= this.nextReplanAt;
  }

  private considerFacePlan(epoch: number, a: ShapeAnalysis) {
    this.facePlanCheckedEpoch = epoch;
    if (this.genome.faceAffinity < 0.1) {
      this.facePlanDone = true; // abstract individual: no facial tendencies at all
      return;
    }
    const model = this.model;
    const occupiedBefore = (x: number, y: number) => {
      const c = model.get(x, y);
      return !!c && c.index < epoch;
    };
    if (this.facePlans.length === 0) {
      if (epoch > FACE_PLAN_MAX_EPOCH) { this.facePlanDone = true; return; }
      if (!canPlanFace(a, this.genome, this.tuning)) return;
      this.facePlans.push(buildFacePlan(a, this.genome, epoch, occupiedBefore, this.tuning));
      this.nextReplanAt = epoch * this.tuning.replanFactor;
      return;
    }
    if (epoch > FACE_REPLAN_MAX_EPOCH) { this.facePlanDone = true; return; }
    const roll = hash32(this.game.initialSeed, 'replan', epoch) / 4294967296;
    if (roll < this.genome.replanChance && canPlanFace(a, this.genome, this.tuning)) {
      this.facePlans.push(buildFacePlan(a, this.genome, epoch, occupiedBefore, this.tuning));
      this.nextReplanAt = epoch * this.tuning.replanFactor;
    } else {
      this.nextReplanAt = Math.ceil(epoch * this.tuning.replanRetryFactor);
    }
  }

  /** Analysis used when generating slot `index` (from pixels [0, epoch)). */
  analysisFor(index: number): { analysis: ShapeAnalysis | null; fresh: boolean } {
    const epoch = epochAtOrBefore(index);
    if (epoch < 8 || epoch > this.model.size) return { analysis: null, fresh: false };
    if (epoch === this.analysisEpoch) return { analysis: this.analysis, fresh: false };
    if (this.needsPlanAttempt(epoch)) this.considerFacePlan(epoch, analyzeShape(this.model.list, epoch, this.genome));
    this.analysis = analyzeShape(this.model.list, epoch, this.genome, this.facePlans, this.tuning);
    this.analysisEpoch = epoch;
    return { analysis: this.analysis, fresh: true };
  }

  /** Analysis of the whole current body (for UI / tooling; not used for generation). */
  currentAnalysis(): ShapeAnalysis | null {
    if (this.model.size < 8) return null;
    return analyzeShape(this.model.list, this.model.size, this.genome, this.facePlans, this.tuning);
  }

  generateNext(slot: Omit<SlotInput, 'growthIndex'>): { pixel: Pixel; analysis: ShapeAnalysis | null; freshAnalysis: boolean } {
    const growthIndex = this.nextIndex;
    const { analysis, fresh } = this.analysisFor(growthIndex);
    const model = this.model;
    const earlyFace = !analysis && this.genome.marks && this.facePlans.length
      ? earlyFaceZones(this.facePlans, this.genome, model.size, (x, y) => model.has(x, y), this.tuning)
      : null;
    const pixel = GENERATORS[this.game.generatorVersion]({
      game: this.game,
      tuning: this.tuning,
      earlyFace,
      genome: this.genome,
      model: this.model,
      analysis,
      slot: { ...slot, growthIndex },
    });
    this.model.add(pixel);
    return { pixel, analysis, freshAnalysis: fresh };
  }
}
