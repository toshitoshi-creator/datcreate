import { DAY_MS, HOUR_MS } from './constants';

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

/**
 * Index of the latest growth slot that is due at `now`.
 * Slot 0 is the initial dot at startedAt; slot i is due at startedAt + i hours.
 * Never negative, so a clock set before the start never produces growth.
 */
export function dueGrowthIndex(startedAt: number, now: number): number {
  if (!Number.isFinite(now) || now < startedAt) return 0;
  return Math.floor((now - startedAt) / HOUR_MS);
}

export function growthTime(startedAt: number, index: number): number {
  return startedAt + index * HOUR_MS;
}

export function nextGrowthAt(startedAt: number, lastProcessedGrowthIndex: number): number {
  return growthTime(startedAt, lastProcessedGrowthIndex + 1);
}

export function timeOfDayFromHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 16) return 'day';
  if (hour >= 16 && hour < 19) return 'evening';
  return 'night';
}

export function elapsedParts(startedAt: number, now: number) {
  const ms = Math.max(0, now - startedAt);
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / 60_000);
  return { days, hours, minutes };
}

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/** Start of the effective schedule: items pull every later slot earlier. */
export function scheduleStart(game: { startedAt: number; timeBonusMs?: number }): number {
  return game.startedAt - (game.timeBonusMs ?? 0);
}
