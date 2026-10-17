import { describe, expect, it } from 'vitest';
import { createOpenMeteoProvider, owmToWeather, wmoToWeather } from '../../src/services/weather';

describe('weather mapping', () => {
  it('maps WMO codes', () => {
    expect(wmoToWeather(0)).toBe('clear');
    expect(wmoToWeather(3)).toBe('cloudy');
    expect(wmoToWeather(45)).toBe('fog');
    expect(wmoToWeather(63)).toBe('rain');
    expect(wmoToWeather(73)).toBe('snow');
    expect(wmoToWeather(95)).toBe('storm');
  });
  it('maps OpenWeatherMap ids', () => {
    expect(owmToWeather(800)).toBe('clear');
    expect(owmToWeather(803)).toBe('cloudy');
    expect(owmToWeather(501)).toBe('rain');
    expect(owmToWeather(601)).toBe('snow');
  });
  it('open-meteo provider parses and rejects bad responses; coords are rounded in the URL', async () => {
    let url = '';
    const p = createOpenMeteoProvider((async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ current: { weather_code: 61, temperature_2m: 9.5 } }));
    }) as typeof fetch);
    expect(await p.fetchCurrent(35.681236, 139.767125)).toEqual({ weather: 'rain', code: 61, temperatureC: 9.5 });
    expect(url).toContain('latitude=35.68');
    expect(url).not.toContain('35.6812');
    const bad = createOpenMeteoProvider((async () => new Response('{}')) as typeof fetch);
    await expect(bad.fetchCurrent(0, 0)).rejects.toThrow();
    const http = createOpenMeteoProvider((async () => new Response('x', { status: 500 })) as typeof fetch);
    await expect(http.fetchCurrent(0, 0)).rejects.toThrow();
  });
});
