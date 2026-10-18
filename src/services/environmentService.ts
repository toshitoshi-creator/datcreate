import { hash32 } from '../core/rng';
import { timeOfDayFromHour } from '../core/time';
import type { EnvironmentLog, FetchStatus } from '../core/types';
import { getCoarseLocation } from './location';
import type { WeatherProvider } from './weather';

export interface EnvironmentServiceOptions {
  provider: WeatherProvider;
  geolocation: Geolocation | null;
  timeoutMs?: number;
}

/**
 * Captures environment snapshots. Never throws: any failure yields a log with
 * weather 'unknown' and a fetchStatus explaining why, so growth continues.
 */
export class EnvironmentService {
  private coords: { lat: number; lon: number } | null = null;
  private counter = 0;

  constructor(private readonly opts: EnvironmentServiceOptions) {}

  /**
   * A coarse place code (about 5 km cells) for the current position, or null.
   * Only this number is used (for precious dots); coordinates are never stored.
   */
  placeCode(): number | null {
    if (!this.coords) return null;
    return Math.round(this.coords.lat * 20) * 7919 + Math.round(this.coords.lon * 20);
  }

  /** Forget the in-memory position (e.g. when the user disables location). */
  clearLocation() {
    this.coords = null;
  }

  async capture(now: number, gameId: string | null, locationEnabled: boolean): Promise<EnvironmentLog> {
    const hour = new Date(now).getHours();
    const base: EnvironmentLog = {
      id: `env:${now}:${(hash32(now, this.counter++, Math.floor(performance.now())) % 1e6).toString(36)}`,
      gameId: gameId ?? 'none',
      capturedAt: now,
      timeOfDay: timeOfDayFromHour(hour),
      localHour: hour,
      weather: 'unknown',
      weatherCode: null,
      temperatureC: null,
      locationEnabled,
      location: null,
      source: 'none',
      fetchStatus: 'disabled',
    };
    if (!locationEnabled) return base;

    if (!this.coords) {
      const loc = await getCoarseLocation(this.opts.geolocation, this.opts.timeoutMs ?? 10_000);
      if (loc.status !== 'ok') return { ...base, fetchStatus: loc.status === 'denied' ? 'denied' : (loc.status as FetchStatus) };
      this.coords = { lat: loc.lat, lon: loc.lon };
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), this.opts.timeoutMs ?? 10_000);
    try {
      const r = await this.opts.provider.fetchCurrent(this.coords.lat, this.coords.lon, ctrl?.signal);
      return { ...base, weather: r.weather, weatherCode: r.code, temperatureC: r.temperatureC, source: this.opts.provider.source, fetchStatus: 'ok' };
    } catch (e) {
      const aborted = (e as Error)?.name === 'AbortError';
      return { ...base, source: this.opts.provider.source, fetchStatus: aborted ? 'timeout' : 'error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
