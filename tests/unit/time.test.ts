import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS } from '../../src/core/constants';
import { dueGrowthIndex, growthTime, nextGrowthAt, timeOfDayFromHour } from '../../src/core/time';

describe('growth schedule', () => {
  const start = new Date(2026, 0, 5, 9, 37).getTime();

  it('adds nothing before one full hour has elapsed', () => {
    expect(dueGrowthIndex(start, start)).toBe(0);
    expect(dueGrowthIndex(start, start + HOUR_MS - 1)).toBe(0);
    expect(dueGrowthIndex(start, start + HOUR_MS)).toBe(1);
  });

  it('anchors slots to the start time (9:37 -> 10:37, 11:37, ...)', () => {
    expect(new Date(nextGrowthAt(start, 0)).getMinutes()).toBe(37);
    expect(new Date(nextGrowthAt(start, 0)).getHours()).toBe(10);
    expect(new Date(growthTime(start, 2)).getHours()).toBe(11);
  });

  it('30 days later the due index is 720 (721 dots) and keeps going', () => {
    expect(dueGrowthIndex(start, start + 30 * DAY_MS)).toBe(720);
    expect(dueGrowthIndex(start, start + 400 * DAY_MS)).toBe(9600);
  });

  it('a clock earlier than the start never yields growth', () => {
    expect(dueGrowthIndex(start, start - 5 * DAY_MS)).toBe(0);
    expect(dueGrowthIndex(start, Number.NaN)).toBe(0);
  });

  it('maps hours to times of day', () => {
    expect(timeOfDayFromHour(6)).toBe('morning');
    expect(timeOfDayFromHour(12)).toBe('day');
    expect(timeOfDayFromHour(17)).toBe('evening');
    expect(timeOfDayFromHour(23)).toBe('night');
    expect(timeOfDayFromHour(3)).toBe('night');
  });
});
