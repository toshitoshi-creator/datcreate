import type { ShapeAnalysis } from './analysis';
import type { Milestone, Pixel } from './types';

const COUNT_MARKS = [10, 50, 100, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000, 50000, 100000];
const DAY_MARKS = [1, 7, 30, 100, 180, 365, 500, 730, 1000, 1095, 1825, 3650];

export const MILESTONE_LABEL: Record<string, string> = {
  'shape:hole': '内側に小さな空白が生まれた',
  'shape:split': '本体から離れた点群が生まれた',
  'shape:twin-peaks': '複数の密度の高まりが生まれた',
  'shape:eye-like': '目のようにも見える空白が残った',
  'shape:mouth-like': '口のようにも見える横長の空白が生まれた',
  'shape:protrusion': '細い突起が伸び始めた',
  'shape:limb-like': '手足のような長い突起ができた',
  'shape:asymmetric': '左右非対称な形が際立ってきた',
  'shape:symmetric': '左右対称に近い形になってきた',
  'shape:elongated': '細長い体つきになってきた',
};

export function milestoneLabel(m: Pick<Milestone, 'type'>): string {
  if (m.type.startsWith('count:')) return `${Number(m.type.slice(6)).toLocaleString('ja-JP')} ドットに到達`;
  if (m.type.startsWith('day:')) return `${m.type.slice(4)} 日目を迎えた`;
  if (m.type.startsWith('clock-rollback')) return '端末の時計の巻き戻りを検出（データは変更なし）';
  return MILESTONE_LABEL[m.type] ?? m.type;
}

/**
 * Records notable *observed* shape changes. These are analysis records only;
 * they never feed back into or alter existing pixels.
 */
export function detectMilestones(
  pixel: Pixel,
  analysis: ShapeAnalysis | null,
  achieved: Set<string>,
): Milestone[] {
  const out: Milestone[] = [];
  const count = pixel.growthIndex + 1;
  const add = (type: string, extra: Record<string, number | string | boolean> = {}) => {
    const id = `${pixel.gameId}:${type}`;
    if (achieved.has(id)) return;
    achieved.add(id);
    out.push({
      id,
      gameId: pixel.gameId,
      achievedAt: pixel.createdAt,
      type,
      metadata: { growthIndex: pixel.growthIndex, pixelCount: count, ...extra },
    });
  };
  if (COUNT_MARKS.includes(count)) add(`count:${count}`);
  if (pixel.growthIndex > 0 && pixel.growthIndex % 24 === 0 && DAY_MARKS.includes(pixel.growthIndex / 24)) {
    add(`day:${pixel.growthIndex / 24}`);
  }
  if (analysis) {
    const a = analysis;
    const meta = { symmetry: Math.round(a.symmetry * 100) / 100, components: a.components, holes: a.holeCount };
    if (a.holeCount >= 1) add('shape:hole', meta);
    if (a.components >= 2) add('shape:split', meta);
    if (a.analyzedCount >= 50 && a.densityPeaks >= 2) add('shape:twin-peaks', { ...meta, peaks: a.densityPeaks });
    if (a.face && a.face.eyesFromHoles >= 1) add('shape:eye-like', { ...meta, eyes: a.face.eyesFromHoles });
    if (a.face && a.face.mouthFromHole) add('shape:mouth-like', meta);
    if (a.thinProtrusions >= 4) add('shape:protrusion', { ...meta, thin: a.thinProtrusions });
    const longest = a.limbs.reduce((m, l) => Math.max(m, l.protrusion), 0);
    if (longest >= Math.max(4, a.radius * 0.8) && a.thinProtrusions >= 3) add('shape:limb-like', { ...meta, length: Math.round(longest) });
    if (a.analyzedCount >= 120 && a.symmetry < 0.4) add('shape:asymmetric', meta);
    if (a.analyzedCount >= 120 && a.symmetry >= 0.75) add('shape:symmetric', meta);
    const ratio = a.core.w / a.core.h;
    if (a.analyzedCount >= 80 && (ratio >= 1.8 || ratio <= 0.55)) add('shape:elongated', { ...meta, ratio: Math.round(ratio * 100) / 100 });
  }
  return out;
}

/** Canonical history order (same in memory and after reload). */
export function sortMilestones(ms: Milestone[]): Milestone[] {
  return ms.sort((a, b) => a.achievedAt - b.achievedAt || a.metadata.growthIndex - b.metadata.growthIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
