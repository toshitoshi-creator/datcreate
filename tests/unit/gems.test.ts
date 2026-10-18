import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../../src/core/constants';
import { countGems, gemPoints, gemRates, launchLuck, placeLuck, rollGem } from '../../src/core/gems';
import { Simulation } from '../../src/core/generator';
import { resolveStyle } from '../../src/core/looks';
import { hash32 } from '../../src/core/rng';
import { TOTAL_MAX, abilityTotal, statsOf } from '../../src/core/stats';
import { timeOfDayFromHour } from '../../src/core/time';
import type { EnvUsed, Pixel, Weather } from '../../src/core/types';
import { growWildDot } from '../../src/core/wild';
import { FakeClock, T0, makeHarness } from '../helpers';

const env = (weather: Weather, hour: number): EnvUsed => ({ timeOfDay: timeOfDayFromHour(hour), localHour: hour, weather, environmentInfluence: 0.6, organicShapeBias: 0.6 });

/** Grow a finished creature with changing weather and the app opened every few hours. */
function finished(k: number): Pixel[] {
  const seed = (k * 2654435761 + 99) >>> 0;
  const look = resolveStyle('random', seed);
  const sim = new Simulation({ gameId: 'g', initialSeed: seed, generatorVersion: 3, style: look.style, species: look.species });
  const W: Weather[] = ['clear', 'clear', 'cloudy', 'rain', 'clear', 'cloudy', 'fog', 'snow', 'storm'];
  const out: Pixel[] = [];
  let opened = T0;
  for (let i = 0; i < 721; i++) {
    const t = T0 + i * HOUR_MS, h = new Date(t).getHours();
    const e = env(W[hash32(seed, Math.floor(i / 8)) % W.length], h);
    const r = sim.generateNext({ createdAt: t, env: e, environmentSnapshotId: null });
    if (t >= opened) opened = t + (2 + (hash32(seed, i, 'open') % 10)) * HOUR_MS;
    const box = r.analysis?.face?.box;
    const inFace = !!box && r.pixel.x >= box.x0 && r.pixel.x <= box.x1 && r.pixel.y >= box.y0 && r.pixel.y <= box.y1;
    out.push({ ...r.pixel, gem: rollGem({ initialSeed: seed, growthIndex: i, env: e, processedAt: opened, place: null, inFace }) });
  }
  return out;
}

describe('precious dots and the ability total', () => {
  it('finished creatures average about 100, vary from weak to strong, and never exceed 150', () => {
    const totals = Array.from({ length: 40 }, (_, k) => abilityTotal(finished(k)));
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    expect(mean).toBeGreaterThan(92);
    expect(mean).toBeLessThan(108);
    expect(Math.max(...totals)).toBeLessThanOrEqual(TOTAL_MAX);
    expect(Math.max(...totals) - Math.min(...totals)).toBeGreaterThan(25);
  });

  it('more and rarer precious dots make a bigger total; the four stats add up to it', () => {
    const base = finished(3).map((p) => ({ ...p, gem: null }));
    const some = base.map((p, i) => (i % 100 === 50 ? { ...p, gem: 'gold' as const } : p));
    const more = base.map((p, i) => (i % 50 === 25 ? { ...p, gem: 'diamond' as const } : p));
    expect(abilityTotal(some)).toBeGreaterThan(abilityTotal(base));
    expect(abilityTotal(more)).toBeGreaterThan(abilityTotal(some));
    const s = statsOf(more);
    expect(s.strength + s.defense + s.speed + s.luck).toBe(abilityTotal(more));
    expect(gemPoints(more)).toBe(countGems(more).diamond * 6);
  });

  it('weather and time of day change the chances; launch time and place add luck', () => {
    expect(gemRates(env('clear', 12)).gold).toBeGreaterThan(gemRates(env('rain', 12)).gold);
    expect(gemRates(env('clear', 23)).diamond).toBeGreaterThan(gemRates(env('cloudy', 12)).diamond);
    expect(gemRates(env('snow', 17)).platinum).toBeGreaterThan(gemRates(env('clear', 12)).platinum);
    expect(gemRates(env('rain', 2)).silver).toBeGreaterThan(gemRates(env('clear', 12)).silver);
    const lucks = Array.from({ length: 50 }, (_, i) => launchLuck(1, i * 600_000));
    expect(Math.min(...lucks)).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...lucks)).toBeLessThanOrEqual(1.6);
    expect(new Set(lucks).size).toBeGreaterThan(10);
    expect(placeLuck(1, null)).toBe(1);
    expect(placeLuck(1, 123)).not.toBe(placeLuck(1, 456));
    // never in the face, never in the first dots
    expect(rollGem({ initialSeed: 1, growthIndex: 500, env: env('clear', 23), processedAt: 0, place: null, inFace: true })).toBeNull();
    expect(rollGem({ initialSeed: 1, growthIndex: 5, env: env('clear', 23), processedAt: 0, place: null, inFace: false })).toBeNull();
  });

  it('wild dots and rivals find precious dots too', () => {
    const totals = Array.from({ length: 12 }, (_, k) => abilityTotal(growWildDot(k * 31 + 7, 721)));
    expect(totals.some((t) => t > 100)).toBe(true);
    expect(totals.some((t) => t < 100)).toBe(true);
  });

  it('the game decides and stores precious dots as it grows; they survive a restart', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    await h.controller.startNewGame();
    clock.advance(30 * DAY_MS);
    await h.controller.checkGrowth();
    const px = h.controller.pixels;
    expect(px.every((p) => p.gem === null || typeof p.gem === 'string')).toBe(true);
    expect(px.slice(0, 30).every((p) => p.gem === null)).toBe(true);
    const stored = await h.repo.loadPixels(px[0].gameId);
    expect(stored.map((p) => p.gem ?? null)).toEqual(px.map((p) => p.gem ?? null));
  });
});
