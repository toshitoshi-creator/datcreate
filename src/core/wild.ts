import { HOUR_MS } from './constants';
import { Simulation } from './generator';
import { hash32 } from './rng';
import { resolveStyle } from './looks';
import { timeOfDayFromHour } from './time';
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
  for (let i = 0; i < dots; i++) {
    const hour = (9 + i) % 24;
    pixels.push(
      sim.generateNext({
        createdAt: i * HOUR_MS,
        env: { timeOfDay: timeOfDayFromHour(hour), localHour: hour, weather: 'unknown', environmentInfluence: 0.6, organicShapeBias: 0.6 },
        environmentSnapshotId: null,
      }).pixel,
    );
  }
  return pixels;
}
