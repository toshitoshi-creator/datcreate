import { HOUR_MS } from './constants';
import { Simulation } from './generator';
import { hash32 } from './rng';
import { resolveStyle } from './looks';
import { timeOfDayFromHour } from './time';
import { rollGem } from './gems';
import type { Pixel } from './types';

/**
 * A "wild dot" opponent: a creature grown on the spot from a seed with the
 * normal rules (random look, neutral weather), so its stats come from its
 * colours like everyone else's. Nothing is stored.
 */
export function growWildDot(seed: number, dots: number): Pixel[] {
  const look = resolveStyle('random', hash32(seed, 'wild-look'));
  const sim = new Simulation({ gameId: 'wild', initialSeed: seed >>> 0, generatorVersion: 3, style: look.style, species: look.species });
  const pixels: Pixel[] = [];
  const WEATHER = ['clear', 'cloudy', 'rain', 'clear', 'fog', 'snow'] as const;
  for (let i = 0; i < dots; i++) {
    const hour = (9 + i) % 24;
    // wild dots live through their own weather, so they find precious dots too
    const weather = WEATHER[hash32(seed, Math.floor(i / 8), 'wild-weather') % WEATHER.length];
    const env = { timeOfDay: timeOfDayFromHour(hour), localHour: hour, weather, environmentInfluence: 0.6, organicShapeBias: 0.6 };
    const r = sim.generateNext({ createdAt: i * HOUR_MS, env: { ...env, weather: 'unknown' }, environmentSnapshotId: null });
    const box = r.analysis?.face?.box;
    const inFace = !!box && r.pixel.x >= box.x0 && r.pixel.x <= box.x1 && r.pixel.y >= box.y0 && r.pixel.y <= box.y1;
    pixels.push({ ...r.pixel, gem: rollGem({ initialSeed: seed >>> 0, growthIndex: i, env, processedAt: Math.floor(i / 5) * 3 * HOUR_MS, place: null, inFace }) });
  }
  return pixels;
}
