import type { Genome, LimbGene } from './genome';
import { cellKey, type CellInfo } from './model';
import { TUNINGS, type Tuning } from './tuning';

export interface Hole {
  cx: number;
  cy: number;
  size: number;
  w: number;
  h: number;
  /** World cell keys (only kept for small holes). */
  keys: number[];
}

export type AccentKind = 'eye' | 'eyeRim' | 'nose' | 'cheek' | 'shine' | 'ink';

/**
 * Weak tendencies for future placement. These are *not* parts: nothing is
 * drawn from them, and existing pixels are never touched because of them.
 */
export interface FaceZones {
  strength: number;
  /** Cells where placement is discouraged (eye / mouth hollows). Value = strength. */
  hollow: Map<number, number>;
  /** Cells that get colour accents (and, for bright eyes / nose, mild encouragement). */
  accent: Map<number, AccentKind>;
  eyeCount: number;
  eyesFromHoles: number;
  mouthFromHole: boolean;
  hasNose: boolean;
  /** Painted-face cells that lie in an enclosed gap (v3: free to fill in). */
  enclosed: Set<number>;
  /** Rough box around the facial features (for calmer face colouring). */
  box: { x0: number; x1: number; y0: number; y1: number };
}

/**
 * World-anchored facial tendencies, decided once when the body first becomes
 * dense enough. Anchors are placed on *empty* cells next to the body so the
 * body may (or may not) grow around them, leaving gaps that read as eyes / mouth.
 */
export interface FacePlan {
  epoch: number;
  eyes: { x: number; y: number; r: number }[];
  mouth: [number, number][];
  nose: { x: number; y: number } | null;
}

export const FACE_PLAN_MAX_EPOCH = 700;
/** Later re-plans (larger features) are only attempted below this size. */
export const FACE_REPLAN_MAX_EPOCH = 60_000;

export function canPlanFace(a: ShapeAnalysis, genome: Genome, t: Tuning = TUNINGS[1]): boolean {
  return (
    genome.faceAffinity >= 0.1 &&
    a.mainSize >= t.faceMinMain &&
    a.core.w >= t.faceMinCore &&
    a.core.h >= t.faceMinCore &&
    a.fillRatio >= t.faceMinFill
  );
}

export function buildFacePlan(
  a: ShapeAnalysis,
  genome: Genome,
  epoch: number,
  occupied: (x: number, y: number) => boolean,
  t: Tuning = TUNINGS[1],
): FacePlan {
  const { core } = a;
  const nearestEmpty = (tx: number, ty: number): [number, number] => {
    const rx = Math.round(tx), ry = Math.round(ty);
    for (let rad = 0; rad <= 16; rad++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const x = rx + dx, y = ry + dy;
          if (occupied(x, y)) continue;
          // prefer moving up/outward for eyes: tie-break by distance then y
          const d = Math.hypot(x - tx, y - ty) + (y > ty ? 0.3 : 0);
          if (d < bd) { bd = d; best = [x, y]; }
        }
      }
      if (best) return best;
    }
    return [rx, ry];
  };
  const eyes = genome.eyes.map((e) => {
    const [x, y] = nearestEmpty(core.cx + e.dx * core.w * t.eyeXScale, core.y0 + e.dy * core.h * t.eyeYScale);
    return { x, y, r: Math.max(t.eyeRadiusMin, Math.min(t.eyeRadiusMax, Math.min(core.w, core.h) * e.size)) };
  });
  const mouth: [number, number][] = [];
  if (genome.hasMouth) {
    const hw = Math.max(1, (genome.mouthWidth * core.w) / 2);
    const mcx = core.cx + genome.mouthDx * core.w;
    const line = (shift: number) => {
      const out: [number, number][] = [];
      for (let gx = Math.round(mcx - hw); gx <= Math.round(mcx + hw); gx++) {
        const t = (gx - mcx) / hw;
        out.push([gx, Math.round(core.y0 + genome.mouthY * core.h + shift - genome.mouthCurve * t * t * 1.5)]);
      }
      return out;
    };
    for (let shift = 0; shift <= 16; shift++) {
      const l = line(shift);
      const empty = l.filter(([x, y]) => !occupied(x, y)).length;
      if (empty >= l.length * 0.7) { mouth.push(...l); break; }
    }
  }
  let nose: FacePlan['nose'] = null;
  if (genome.hasNose && eyes.length) {
    const ey = eyes.reduce((s, e) => s + e.y, 0) / eyes.length;
    const my = mouth.length ? mouth.reduce((s, [, y]) => s + y, 0) / mouth.length : ey + core.h * 0.3;
    nose = { x: Math.round(eyes.reduce((s, e) => s + e.x, 0) / eyes.length), y: Math.round((ey + my) / 2) };
  }
  return { epoch, eyes, mouth, nose };
}

/**
 * v3: facial tendencies planned up-front for the body's expected size at
 * `t.futureFaceAt` dots. The cells lie in empty space the round body has yet
 * to grow into, so the body may close around them and a face can *appear*
 * after some days. Pure function of the genome.
 */
export function buildFuturePlan(genome: Genome, t: Tuning): FacePlan | null {
  if (genome.faceAffinity < 0.1 || t.futureFaceAt <= 0) return null;
  const Rb = Math.sqrt(t.futureFaceAt / (Math.PI * genome.blobArea));
  const head = genome.blobs[0];
  const hw = head.rx * Rb, hh = head.ry * Rb;
  const cx = head.ox * Rb, cy = head.oy * Rb;
  const eyes = genome.eyes.map((e) => ({
    x: Math.round(cx + e.dx * hw),
    y: Math.round(cy + e.dy * hh),
    r: Math.max(t.eyeRadiusMin, Math.min(t.eyeRadiusMax, e.size * Rb)),
  }));
  const mouth: [number, number][] = [];
  if (genome.hasMouth) {
    const my = cy + genome.mouthY * hh;
    const half = Math.max(1, Math.round(genome.mouthWidth * hw));
    for (let gx = -half; gx <= half; gx++) {
      const u = gx / half;
      mouth.push([Math.round(cx) + gx, Math.round(my - genome.mouthCurve * u * u * 1.2)]);
    }
  }
  return { epoch: 24, eyes, mouth, nose: null };
}

function buildFaceZones(
  plans: readonly FacePlan[],
  genome: Genome,
  mainSize: number,
  holes: Hole[],
  occupied: (x: number, y: number) => boolean,
  t: Tuning,
): FaceZones {
  const latest = plans[plans.length - 1];
  const strength = genome.faceAffinity * (0.6 + 0.4 * smoothstep(latest.epoch, latest.epoch * 3, mainSize));
  const hollow = new Map<number, number>();
  const accent = new Map<number, AccentKind>();
  const holeOf = (x: number, y: number) => {
    const k = cellKey(x, y);
    return holes.find((h) => h.keys.includes(k));
  };
  let eyesFromHoles = 0;
  let eyeCount = 0;
  let mouthFromHole = false;
  let hasNose = false;
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  const grow = (x: number, y: number, r: number) => {
    bx0 = Math.min(bx0, x - r); bx1 = Math.max(bx1, x + r); by0 = Math.min(by0, y - r); by1 = Math.max(by1, y + r);
  };
  const pupilEyes = genome.eyeStyle === 'bright' && t.brightPupil;
  // Older plans keep a weaker tendency; the newest one overrides overlaps.
  plans.forEach((plan, i) => {
    const st = i === plans.length - 1 ? strength : strength * 0.6;
    eyeCount += plan.eyes.length;
    for (const e of plan.eyes) {
      const R = Math.ceil(e.r + 1.5);
      const Ry = Math.ceil(e.r * t.eyeAspect + 1.5);
      grow(e.x, e.y, e.r * t.eyeAspect + 2);
      const pupil = Math.max(0.5, e.r * 0.45);
      for (let gy = e.y - Ry; gy <= e.y + Ry; gy++) {
        for (let gx = e.x - R; gx <= e.x + R; gx++) {
          const d = Math.hypot(gx - e.x, (gy - e.y) / t.eyeAspect);
          const k = cellKey(gx, gy);
          if (pupilEyes) {
            // bright sclera around a small dark (empty) pupil
            if (d <= pupil) { hollow.set(k, st); accent.delete(k); }
            else if (d <= e.r + 0.7) { accent.set(k, 'eye'); hollow.delete(k); }
            else if (d <= e.r + 1.6 && !hollow.has(k) && !accent.has(k)) accent.set(k, 'eyeRim');
          } else if (d <= e.r && t.paintedFace) {
            accent.set(k, 'ink'); // dark eye colour on whatever dot lands here
            hollow.delete(k);
          } else if (d <= e.r) {
            if (genome.eyeStyle === 'hollow') { hollow.set(k, st); accent.delete(k); }
            else { accent.set(k, 'eye'); hollow.delete(k); }
          } else if (t.eyeRim && d <= e.r + 1.3 && !hollow.has(k) && !accent.has(k)) {
            accent.set(k, 'eyeRim');
          }
        }
      }
      if (t.eyeShine) {
        // a single highlight dot at the upper-left of the eye
        const sk = cellKey(Math.round(e.x - e.r * 0.4), Math.round(e.y - e.r * t.eyeAspect * 0.45));
        hollow.delete(sk);
        accent.set(sk, 'shine');
      }
      if (t.paintedFace) {
        if (occupied(e.x, e.y) && occupied(e.x, e.y - 1) && occupied(e.x, e.y + 1)) eyesFromHoles++;
      } else if (genome.eyeStyle === 'hollow' && !occupied(e.x, e.y)) {
        const h = holeOf(e.x, e.y);
        if (h && h.size <= (t.eyeShine ? 200 : 60)) eyesFromHoles++;
      } else if (pupilEyes) {
        let ring = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (occupied(e.x + dx, e.y + dy)) ring++;
        if (!occupied(e.x, e.y) && ring >= 3) eyesFromHoles++;
      } else if (genome.eyeStyle === 'bright' && occupied(e.x, e.y)) {
        eyesFromHoles++;
      }
      if (t.cheeks && genome.hasCheeks && plan.eyes.length >= 2) {
        const side = e.x < plan.eyes.reduce((sum, q) => sum + q.x, 0) / plan.eyes.length ? -1 : 1;
        const cx = Math.round(e.x + side * Math.max(1, e.r * 0.6));
        const cy = Math.round(e.y + e.r * t.eyeAspect + (t.eyeAspect > 1 ? 1 : 2));
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0]] as const) {
          const k = cellKey(cx + dx, cy + dy);
          if (!hollow.has(k) && !accent.has(k)) accent.set(k, 'cheek');
        }
      }
    }
    if (plan.mouth.length) {
      let enclosed = 0;
      for (const [x, y] of plan.mouth) {
        grow(x, y, 1);
        const k = cellKey(x, y);
        if (t.paintedFace) {
          accent.set(k, 'ink');
          hollow.delete(k);
          if (occupied(x, y)) enclosed++;
          continue;
        }
        hollow.set(k, st * 0.9);
        accent.delete(k);
        if (!occupied(x, y) && holeOf(x, y)) enclosed++;
      }
      if (enclosed >= Math.max(2, plan.mouth.length * 0.5)) mouthFromHole = true;
    }
    if (plan.nose) {
      hasNose = true;
      for (const [dx, dy] of [[0, 0], [0, 1], [1, 0], [-1, 0]] as const) {
        const k = cellKey(plan.nose.x + dx, plan.nose.y + dy);
        if (!hollow.has(k)) accent.set(k, 'nose');
      }
    }
  });
  const enclosed = new Set<number>();
  if (t.paintedFace) {
    const holeKeys = new Set<number>();
    for (const h of holes) for (const k of h.keys) holeKeys.add(k);
    for (const k of accent.keys()) if (holeKeys.has(k)) enclosed.add(k);
  }
  return { strength, hollow, accent, eyeCount, eyesFromHoles, mouthFromHole, hasNose, enclosed, box: { x0: bx0, x1: bx1, y0: by0, y1: by1 } };
}

export interface LimbState {
  gene: LimbGene;
  dirX: number;
  dirY: number;
  tipX: number;
  tipY: number;
  tipProj: number;
  protrusion: number;
  target: number;
}

export interface ShapeAnalysis {
  analyzedCount: number;
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
  centroid: { x: number; y: number };
  radius: number;
  components: number;
  mainSize: number;
  core: { x0: number; x1: number; y0: number; y1: number; cx: number; cy: number; w: number; h: number };
  holes: Hole[];
  holeCount: number;
  /** 0..1 share of main-body cells whose mirror cell is occupied. */
  symmetry: number;
  axisX: number;
  /** -1 (left heavy) .. 1 (right heavy). */
  balanceLR: number;
  /** Fill ratio of top / middle / bottom thirds of the core box. */
  bands: [number, number, number];
  densityPeaks: number;
  thinProtrusions: number;
  face: FaceZones | null;
  /** Occupied share of the core box. */
  fillRatio: number;
  limbs: LimbState[];
}

export const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Analyse the first `count` cells of an individual. Pure and deterministic. */
export function analyzeShape(
  cells: readonly CellInfo[],
  count: number,
  genome: Genome,
  plans: readonly FacePlan[] = [],
  tuning: Tuning = TUNINGS[1],
): ShapeAnalysis {
  const n = Math.min(count, cells.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const ox = minX - 1;
  const oy = minY - 1;
  const W = maxX - minX + 3;
  const H = maxY - minY + 3;
  const occ = new Uint8Array(W * H);
  for (let i = 0; i < n; i++) occ[(cells[i].y - oy) * W + (cells[i].x - ox)] = 1;

  // Connected components (8-connectivity) --------------------------------
  const label = new Int32Array(W * H);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = (cells[i].y - oy) * W + (cells[i].x - ox);
    if (label[start]) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const px = p % W;
      const py = (p - px) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const qx = px + dx, qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
          const q = qy * W + qx;
          if (occ[q] && !label[q]) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    sizes.push(size);
  }
  let mainId = 1;
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[mainId]) mainId = i;
  const mainSize = sizes[mainId] ?? 0;

  // Main body statistics --------------------------------------------------
  const xs: number[] = [];
  const ys: number[] = [];
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (label[(c.y - oy) * W + (c.x - ox)] !== mainId) continue;
    xs.push(c.x);
    ys.push(c.y);
    sx += c.x;
    sy += c.y;
  }
  const m = Math.max(1, xs.length);
  const cx = sx / m;
  const cy = sy / m;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const pct = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))] ?? 0;
  const x0 = pct(xs, 0.06), x1 = pct(xs, 0.94), y0 = pct(ys, 0.06), y1 = pct(ys, 0.94);
  const core = { x0, x1, y0, y1, cx, cy, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const radius = Math.sqrt(mainSize / Math.PI);

  // Holes: empty cells not reachable from outside (4-connectivity) --------
  const outside = new Uint8Array(W * H);
  stack.length = 0;
  outside[0] = 1;
  stack.push(0);
  while (stack.length) {
    const p = stack.pop()!;
    const px = p % W;
    const py = (p - px) / W;
    if (px > 0 && !occ[p - 1] && !outside[p - 1]) { outside[p - 1] = 1; stack.push(p - 1); }
    if (px < W - 1 && !occ[p + 1] && !outside[p + 1]) { outside[p + 1] = 1; stack.push(p + 1); }
    if (py > 0 && !occ[p - W] && !outside[p - W]) { outside[p - W] = 1; stack.push(p - W); }
    if (py < H - 1 && !occ[p + W] && !outside[p + W]) { outside[p + W] = 1; stack.push(p + W); }
  }
  const holes: Hole[] = [];
  let holeCount = 0;
  const seen = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    if (occ[p] || outside[p] || seen[p]) continue;
    holeCount++;
    let size = 0, hx = 0, hy = 0, hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity;
    const keys: number[] = [];
    seen[p] = 1;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % W;
      const qy = (q - qx) / W;
      size++;
      hx += qx; hy += qy;
      if (qx < hx0) hx0 = qx;
      if (qx > hx1) hx1 = qx;
      if (qy < hy0) hy0 = qy;
      if (qy > hy1) hy1 = qy;
      if (keys.length < 400) keys.push(cellKey(qx + ox, qy + oy));
      for (const r of [q - 1, q + 1, q - W, q + W]) {
        if (r >= 0 && r < W * H && !occ[r] && !outside[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
      }
    }
    if (holes.length < 64) {
      holes.push({ cx: hx / size + ox, cy: hy / size + oy, size, w: hx1 - hx0 + 1, h: hy1 - hy0 + 1, keys: size <= 400 ? keys : [] });
    }
  }

  // Symmetry / balance / bands -------------------------------------------
  const axisX = Math.round(cx * 2) / 2;
  let mirrored = 0, left = 0, right = 0;
  const bandCounts: [number, number, number] = [0, 0, 0];
  const at = (x: number, y: number) => {
    const gx = x - ox, gy = y - oy;
    return gx >= 0 && gy >= 0 && gx < W && gy < H && occ[gy * W + gx] === 1;
  };
  let thin = 0;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (label[(c.y - oy) * W + (c.x - ox)] !== mainId) continue;
    if (at(2 * axisX - c.x, c.y)) mirrored++;
    if (c.x < axisX) left++;
    else if (c.x > axisX) right++;
    if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) {
      const b = Math.min(2, Math.floor(((c.y - y0) / core.h) * 3));
      bandCounts[b]++;
    }
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > radius * 1.1) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(c.x + dx, c.y + dy)) k++;
      if (k <= 2) thin++;
    }
  }
  const bandArea = (core.w * core.h) / 3 || 1;
  const bands: [number, number, number] = [bandCounts[0] / bandArea, bandCounts[1] / bandArea, bandCounts[2] / bandArea];
  const symmetry = mainSize ? mirrored / mainSize : 0;
  const balanceLR = left + right ? (right - left) / (left + right) : 0;

  // Local density peaks on 3x3 blocks ------------------------------------
  let densityPeaks = 0;
  if (n >= 30) {
    const BW = Math.ceil(W / 3), BH = Math.ceil(H / 3);
    const blocks = new Uint8Array(BW * BH);
    for (let i = 0; i < n; i++) {
      const gx = cells[i].x - ox, gy = cells[i].y - oy;
      blocks[Math.floor(gy / 3) * BW + Math.floor(gx / 3)]++;
    }
    for (let by = 0; by < BH; by++) {
      for (let bx = 0; bx < BW; bx++) {
        const v = blocks[by * BW + bx];
        if (v < 6) continue;
        let peak = true;
        for (let dy = -1; dy <= 1 && peak; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const qx = bx + dx, qy = by + dy;
            if (qx < 0 || qy < 0 || qx >= BW || qy >= BH) continue;
            if (blocks[qy * BW + qx] > v) { peak = false; break; }
          }
        }
        if (peak) densityPeaks++;
      }
    }
  }

  // Limbs: furthest cell inside a cone along each gene direction ----------
  const limbs: LimbState[] = [];
  if (n >= 20) {
    for (const gene of genome.limbs) {
      const dirX = Math.cos(gene.angle), dirY = Math.sin(gene.angle);
      let tipProj = -Infinity, tipX = Math.round(cx), tipY = Math.round(cy);
      for (let i = 0; i < n; i++) {
        const c = cells[i];
        const rx = c.x - cx, ry = c.y - cy;
        const proj = rx * dirX + ry * dirY;
        if (proj <= tipProj) continue;
        const perp = Math.abs(rx * dirY - ry * dirX);
        if (perp <= 1.5 + Math.max(0, proj) * 0.18) {
          tipProj = proj; tipX = c.x; tipY = c.y;
        }
      }
      limbs.push({ gene, dirX, dirY, tipX, tipY, tipProj, protrusion: tipProj - radius, target: Math.max(3, gene.length * radius) });
    }
  }

  // Face zones (only if a plan was established earlier) -----------------
  let coreCount = 0;
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) coreCount++;
  }
  const fillRatio = coreCount / (core.w * core.h);
  const activePlans = tuning.keepOldPlans ? plans : plans.slice(-1);
  const face = activePlans.length ? buildFaceZones(activePlans, genome, mainSize, holes, (x, y) => at(x, y), tuning) : null;
  return {
    analyzedCount: n,
    bbox: { minX, maxX, minY, maxY },
    centroid: { x: cx, y: cy },
    radius,
    components: sizes.length - 1,
    mainSize,
    core,
    holes,
    holeCount,
    symmetry,
    axisX,
    balanceLR,
    bands,
    densityPeaks,
    thinProtrusions: thin,
    face,
    fillRatio,
    limbs,
  };
}

/**
 * Deterministic schedule of analysis refreshes. Analysis used for slot i is
 * computed from pixels [0, epochAtOrBefore(i)). Gaps grow with size so long
 * catch-ups stay cheap.
 */
const epochCache: number[] = [0, 8];
export function epochAtOrBefore(index: number): number {
  while (epochCache[epochCache.length - 1] <= index) {
    const t = epochCache[epochCache.length - 1];
    epochCache.push(t + Math.max(8, Math.min(256, Math.floor(t * 0.04))));
  }
  // binary search for largest epoch <= index
  let lo = 0, hi = epochCache.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (epochCache[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return epochCache[lo];
}

/** Smallest epoch strictly greater than `index`. */
export function nextEpochAfter(index: number): number {
  epochAtOrBefore(index + 1); // extends the cache past index + 1
  for (const e of epochCache) if (e > index) return e;
  throw new Error('unreachable');
}
