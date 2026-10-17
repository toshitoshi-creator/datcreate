import type { Weather } from '../core/types';

export interface WeatherResult {
  weather: Weather;
  code: number | null;
  temperatureC: number | null;
}

export interface WeatherProvider {
  readonly source: 'open-meteo' | 'openweathermap';
  fetchCurrent(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherResult>;
}

type FetchFn = typeof fetch;

/** WMO weather interpretation codes (used by Open-Meteo). */
export function wmoToWeather(code: number): Weather {
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'unknown';
}

/** OpenWeatherMap condition ids. */
export function owmToWeather(id: number): Weather {
  if (id >= 200 && id < 300) return 'storm';
  if (id >= 300 && id < 600) return 'rain';
  if (id >= 600 && id < 700) return 'snow';
  if (id >= 700 && id < 800) return 'fog';
  if (id === 800) return 'clear';
  if (id > 800 && id < 900) return 'cloudy';
  return 'unknown';
}

export function createOpenMeteoProvider(fetchFn: FetchFn, base = 'https://api.open-meteo.com/v1/forecast'): WeatherProvider {
  return {
    source: 'open-meteo',
    async fetchCurrent(lat, lon, signal) {
      const url = `${base}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&current=weather_code,temperature_2m&timezone=auto`;
      const res = await fetchFn(url, { signal });
      if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
      const json = (await res.json()) as { current?: { weather_code?: number; temperature_2m?: number } };
      const code = json.current?.weather_code;
      if (typeof code !== 'number') throw new Error('weather: malformed response');
      return { weather: wmoToWeather(code), code, temperatureC: json.current?.temperature_2m ?? null };
    },
  };
}

export function createOpenWeatherProvider(fetchFn: FetchFn, apiKey: string): WeatherProvider {
  return {
    source: 'openweathermap',
    async fetchCurrent(lat, lon, signal) {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&units=metric&appid=${encodeURIComponent(apiKey)}`;
      const res = await fetchFn(url, { signal });
      if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
      const json = (await res.json()) as { weather?: { id?: number }[]; main?: { temp?: number } };
      const id = json.weather?.[0]?.id;
      if (typeof id !== 'number') throw new Error('weather: malformed response');
      return { weather: owmToWeather(id), code: id, temperatureC: json.main?.temp ?? null };
    },
  };
}

/** Chooses the provider from build-time env vars; the key is never hard-coded. */
export function defaultWeatherProvider(fetchFn: FetchFn = (...a) => fetch(...a)): WeatherProvider {
  const env = import.meta.env ?? {};
  const owmKey = env.VITE_OPENWEATHER_API_KEY as string | undefined;
  if (owmKey) return createOpenWeatherProvider(fetchFn, owmKey);
  return createOpenMeteoProvider(fetchFn, (env.VITE_WEATHER_API_BASE as string | undefined) || undefined);
}
