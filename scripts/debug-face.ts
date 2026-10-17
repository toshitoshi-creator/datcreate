import { Simulation } from '../src/core/generator';
import { cellKey } from '../src/core/model';
const seed = Number(process.argv[2] ?? 1549107668);
const N = Number(process.argv[3] ?? 720);
const sim = new Simulation({ gameId: 'g', initialSeed: seed, generatorVersion: 1 });
console.log('style', sim.genome.eyeStyle, 'aff', sim.genome.faceAffinity.toFixed(2), 'eyes', sim.genome.eyes.length, 'mouth', sim.genome.hasMouth);
for (let k = 0; k < N; k++) {
  sim.generateNext({ createdAt: 0, env: { timeOfDay: 'day', localHour: 12, weather: 'unknown', environmentInfluence: 0.6, organicShapeBias: 0.6 }, environmentSnapshotId: null });
}
const a = sim.currentAnalysis()!;
console.log('plans', JSON.stringify(sim.plans.map(p => ({ e: p.epoch, eyes: p.eyes.map(e => [e.x, e.y, +e.r.toFixed(1)]), mouth: p.mouth.length }))));
let occ = 0; for (const [k] of a.face?.hollow ?? []) if (sim.model.cells.has(k)) occ++;
console.log('hollow', a.face?.hollow.size, 'occupied', occ);
const m = sim.model;
const lines: string[] = [];
for (let y = m.minY; y <= m.maxY; y++) {
  let row = '';
  for (let x = m.minX; x <= m.maxX; x++) {
    const k = cellKey(x, y);
    const h = a.face?.hollow.has(k);
    row += m.cells.has(k) ? (h ? 'X' : '#') : h ? 'o' : '.';
  }
  lines.push(row);
}
console.log(lines.join('\n'));
