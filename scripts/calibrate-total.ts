import { HOUR_MS } from '../src/core/constants';
import { hexToHsl } from '../src/core/color';
import { gemPoints, rollGem, countGems } from '../src/core/gems';
import { Simulation } from '../src/core/generator';
import { resolveStyle } from '../src/core/looks';
import { hash32 } from '../src/core/rng';
import { timeOfDayFromHour } from '../src/core/time';
import type { Pixel, Weather } from '../src/core/types';

const W: Weather[] = ['clear', 'clear', 'cloudy', 'rain', 'clear', 'cloudy', 'fog', 'snow', 'storm'];
const chromas: number[] = [], pts: number[] = [], dia: number[] = [];
for (let k = 0; k < 80; k++) {
  const seed = (k * 2654435761 + 99) >>> 0;
  const look = resolveStyle('random', seed);
  const sim = new Simulation({ gameId: 'c', initialSeed: seed, generatorVersion: 3, style: look.style, species: look.species });
  const px: Pixel[] = [];
  const start = Date.UTC(2026, 0, 1) + (k % 24) * HOUR_MS;
  let opened = start;
  for (let i = 0; i < 721; i++) {
    const t = start + i * HOUR_MS, h = new Date(t).getHours();
    const weather = W[hash32(seed, Math.floor(i / 8)) % W.length];
    const env = { timeOfDay: timeOfDayFromHour(h), localHour: h, weather, environmentInfluence: 0.6, organicShapeBias: 0.6 };
    const r = sim.generateNext({ createdAt: t, env, environmentSnapshotId: null });
    // the player opens the app now and then: dots are processed at that moment
    if (t >= opened) opened = t + (2 + (hash32(seed, i, 'open') % 10)) * HOUR_MS;
    const box = r.analysis?.face?.box;
    const inFace = !!box && r.pixel.x >= box.x0 && r.pixel.x <= box.x1 && r.pixel.y >= box.y0 && r.pixel.y <= box.y1;
    px.push({ ...r.pixel, gem: rollGem({ initialSeed: seed, growthIndex: i, env, processedAt: opened, place: k % 3 ? null : k, inFace }) });
  }
  const c = px.reduce((s, p) => { const { s: sa, l } = hexToHsl(p.color); return s + sa * (1 - Math.abs(2 * l - 1)); }, 0) / px.length;
  chromas.push(c); pts.push(gemPoints(px)); dia.push(countGems(px).diamond);
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
console.log('chroma mean', mean(chromas).toFixed(4), 'sd', sd(chromas).toFixed(4));
console.log('gem points mean', mean(pts).toFixed(1), 'sd', sd(pts).toFixed(1), 'min', Math.min(...pts), 'max', Math.max(...pts));
console.log('diamonds mean', mean(dia).toFixed(2), 'creatures with one+', dia.filter((d) => d > 0).length, '/ 80');
