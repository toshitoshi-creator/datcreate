import type { TimeOfDay } from './time';
import type { Weather } from './types';

/**
 * How time-of-day and weather nudge growth. All values are small additive
 * score terms (scaled by the environmentInfluence setting), never rules.
 */
export interface EnvEffect {
  outward: number;
  down: number;
  horizontal: number;
  cohesion: number;
  scatter: number;
  fill: number;
  temperature: number;
}

const ZERO: EnvEffect = { outward: 0, down: 0, horizontal: 0, cohesion: 0, scatter: 0, fill: 0, temperature: 0 };

const TIME_EFFECT: Record<TimeOfDay, Partial<EnvEffect>> = {
  morning: { outward: 0.25, temperature: 0.05 },
  day: { outward: 0.45, temperature: 0.1 },
  evening: { horizontal: 0.35 },
  night: { cohesion: 0.35, outward: -0.3, temperature: -0.1 },
};

const WEATHER_EFFECT: Record<Weather, Partial<EnvEffect>> = {
  clear: { down: -0.35, outward: 0.15 },
  cloudy: { fill: 0.4, temperature: -0.05 },
  rain: { down: 0.55, cohesion: 0.1 },
  storm: { down: 0.35, scatter: 0.4, temperature: 0.25 },
  snow: { scatter: 0.55, fill: 0.15 },
  fog: { cohesion: 0.3, temperature: -0.1 },
  unknown: {},
};

export function envEffect(timeOfDay: TimeOfDay, weather: Weather): EnvEffect {
  const out = { ...ZERO };
  for (const part of [TIME_EFFECT[timeOfDay], WEATHER_EFFECT[weather]]) {
    for (const [k, v] of Object.entries(part) as [keyof EnvEffect, number][]) out[k] += v;
  }
  return out;
}

export const TIME_OF_DAY_LABEL: Record<TimeOfDay, string> = {
  morning: '朝',
  day: '昼',
  evening: '夕方',
  night: '夜',
};

export const WEATHER_LABEL: Record<Weather, string> = {
  clear: '晴れ',
  cloudy: '曇り',
  rain: '雨',
  storm: '雷雨',
  snow: '雪',
  fog: '霧',
  unknown: '不明',
};
