import { IDBFactory } from 'fake-indexeddb';
import { HOUR_MS } from '../src/core/constants';
import { Simulation } from '../src/core/generator';
import { timeOfDayFromHour } from '../src/core/time';
import type { EnvUsed, Pixel, Weather } from '../src/core/types';
import { GameRepository } from '../src/data/repository';
import { SettingsStore } from '../src/data/settings';
import type { Clock } from '../src/engine/clock';
import { GameController } from '../src/engine/gameController';
import { EnvironmentService } from '../src/services/environmentService';
import type { WeatherProvider } from '../src/services/weather';

export class FakeClock implements Clock {
  constructor(public t: number) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

export const okProvider = (weather: Weather = 'rain'): WeatherProvider & { calls: number } => {
  const p = {
    source: 'open-meteo' as const,
    calls: 0,
    async fetchCurrent() {
      p.calls++;
      return { weather, code: 61, temperatureC: 12 };
    },
  };
  return p;
};

export const failingProvider = (): WeatherProvider & { calls: number } => {
  const p = {
    source: 'open-meteo' as const,
    calls: 0,
    async fetchCurrent(): Promise<never> {
      p.calls++;
      throw new Error('network down');
    },
  };
  return p;
};

export function fakeGeolocation(mode: 'allow' | 'deny'): Geolocation {
  return {
    getCurrentPosition(success, error) {
      if (mode === 'allow') {
        success({ coords: { latitude: 35.6812, longitude: 139.7671 } } as GeolocationPosition);
      } else {
        error?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      }
    },
    watchPosition: () => 0,
    clearWatch: () => undefined,
  } as Geolocation;
}

export interface Harness {
  controller: GameController;
  repo: GameRepository;
  settings: SettingsStore;
  clock: FakeClock;
  factory: IDBFactory;
  storage: MemoryStorage;
}

/** Build a controller; pass an existing factory/storage to simulate an app restart. */
export async function makeHarness(opts: {
  clock: FakeClock;
  factory?: IDBFactory;
  storage?: MemoryStorage;
  provider?: WeatherProvider;
  geolocation?: Geolocation | null;
  init?: boolean;
}): Promise<Harness> {
  const factory = opts.factory ?? new IDBFactory();
  const storage = opts.storage ?? new MemoryStorage();
  const repo = await GameRepository.open(factory);
  const settings = new SettingsStore(storage);
  const environment = new EnvironmentService({
    provider: opts.provider ?? okProvider('clear'),
    geolocation: opts.geolocation === undefined ? fakeGeolocation('allow') : opts.geolocation,
    timeoutMs: 1000,
  });
  const controller = new GameController({
    repo,
    environment,
    settings,
    clock: opts.clock,
    yieldFn: () => Promise.resolve(),
    envWaitMs: 50,
    chunkSize: 200,
  });
  if (opts.init !== false) await controller.init();
  return { controller, repo, settings, clock: opts.clock, factory, storage };
}

export const T0 = new Date(2026, 0, 5, 9, 37, 0).getTime();
export { HOUR_MS };

export function envAt(hour: number, weather: Weather = 'unknown', organicShapeBias = 0.6, environmentInfluence = 0.6): EnvUsed {
  return { timeOfDay: timeOfDayFromHour(hour), localHour: hour, weather, environmentInfluence, organicShapeBias };
}

/** Grow an individual headlessly. */
export function grow(
  seed: number,
  count: number,
  envFor: (i: number) => EnvUsed = (i) => envAt((9 + i) % 24),
  generatorVersion = 1,
): { sim: Simulation; pixels: Pixel[] } {
  const sim = new Simulation({ gameId: 'test', initialSeed: seed, generatorVersion });
  const pixels: Pixel[] = [];
  for (let i = 0; i < count; i++) {
    pixels.push(sim.generateNext({ createdAt: T0 + i * HOUR_MS, env: envFor(i), environmentSnapshotId: null }).pixel);
  }
  return { sim, pixels };
}
