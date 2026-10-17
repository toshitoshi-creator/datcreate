/**
 * Dev tool: grows several individuals headlessly and writes a contact sheet PNG
 * to scripts/out/ for eyeballing shape diversity. Usage:
 *   npm run sim -- [pixels=500] [count=16] [seedOffset=1]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/core/generator';
import { hexToRgb } from '../src/core/color';
import { timeOfDayFromHour } from '../src/core/time';
import type { Weather } from '../src/core/types';
import { encodePng } from './png';

const [pixels = 500, count = 16, seedOffset = 1] = process.argv.slice(2).map(Number);
const cols = Number(process.env.COLS ?? 4);
const cell = Number(process.env.CELL ?? 200);
const rows = Math.ceil(count / cols);
const W = cols * cell, H = rows * cell;
const img = new Uint8Array(W * H * 3).fill(12);
const weathers: Weather[] = ['clear', 'cloudy', 'rain', 'unknown', 'unknown', 'clear', 'cloudy', 'snow'];
const t0 = Date.now();
for (let i = 0; i < count; i++) {
  const seed = (seedOffset + i) * 2654435761 >>> 0;
  const sim = new Simulation({ gameId: `g${i}`, initialSeed: seed, generatorVersion: Number(process.env.VER ?? 1), style: process.env.STYLE === 'cool' ? 'cool' : undefined });
  for (let k = 0; k < pixels; k++) {
    const hour = (9 + k) % 24;
    sim.generateNext({
      createdAt: k * 3600_000,
      env: { timeOfDay: timeOfDayFromHour(hour), localHour: hour, weather: weathers[(Math.floor(k / 18) * 7 + i) % weathers.length], environmentInfluence: 0.6, organicShapeBias: 0.6 },
      environmentSnapshotId: null,
    });
  }
  const m = sim.model;
  const bw = m.maxX - m.minX + 1, bh = m.maxY - m.minY + 1;
  const scale = Math.max(1, Math.floor((cell - 6) / Math.max(bw, bh)));
  const ox = (i % cols) * cell + Math.floor((cell - bw * scale) / 2);
  const oy = Math.floor(i / cols) * cell + Math.floor((cell - bh * scale) / 2);
  for (const c of m.list) {
    const p = sim.model.get(c.x, c.y)!;
    void p;
  }
  for (const [, c] of m.cells) {
    const hex = hexFromCell(c.h, c.s, c.l);
    const [r, g, b] = hexToRgb(hex);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const px = ox + (c.x - m.minX) * scale + dx, py = oy + (c.y - m.minY) * scale + dy;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const o = (py * W + px) * 3;
      img[o] = r; img[o + 1] = g; img[o + 2] = b;
    }
  }
  const a = sim.currentAnalysis();
  console.log(i, `seed=${seed}`, `bbox=${bw}x${bh}`, `holes=${a?.holeCount}`, `comp=${a?.components}`, `sym=${a?.symmetry.toFixed(2)}`, `face=${a?.face ? `${a.face.eyesFromHoles}/${a.face.eyeCount}${a.face.mouthFromHole ? '+m' : ''}` : '-'}`, `faceAff=${sim.genome.faceAffinity.toFixed(2)}`, `limbs=${sim.genome.limbs.length}`);
}
import { hslToHex } from '../src/core/color';
function hexFromCell(h: number, s: number, l: number) { return hslToHex({ h, s, l }); }
mkdirSync('scripts/out', { recursive: true });
const file = `scripts/out/sheet-v${process.env.VER ?? 1}${process.env.STYLE ?? ""}-${pixels}-${seedOffset}.png`;
writeFileSync(file, encodePng(W, H, img));
console.log('wrote', file, `${Date.now() - t0}ms`);
