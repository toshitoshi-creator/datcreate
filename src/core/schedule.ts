import { HOUR_MS } from './constants';
import type { GameState } from './types';

/**
 * The growth schedule with items and pace-ups.
 *
 * "Effective time" runs ahead of the clock: by `timeBonusMs` (ごはん / あそぶ),
 * and faster while a pace-up (時短アイテム) is running. Slot i is due when
 * the effective time reaches startedAt + i hours. Pace-ups run one after
 * another; each one makes time run BOOST_RATE times faster until it has saved
 * its whole amount, so using one never adds a dot on the spot.
 * A game with no pace-ups is exactly the old schedule (startedAt - bonus + i h).
 */
export const BOOST_RATE = 6;

export type ScheduleGame = Pick<GameState, 'startedAt' | 'timeBonusMs' | 'boosts'>;

interface Segment {
  start: number;
  end: number;
  ms: number;
}

function segments(game: ScheduleGame): Segment[] {
  const out: Segment[] = [];
  let prevEnd = -Infinity;
  for (const b of game.boosts ?? []) {
    const start = Math.max(b.at, prevEnd);
    const end = start + b.ms / (BOOST_RATE - 1);
    out.push({ start, end, ms: b.ms });
    prevEnd = end;
  }
  return out;
}

/** Time saved by pace-ups up to `t` (ms of effective time). */
export function boostAccrued(game: ScheduleGame, t: number): number {
  let acc = 0;
  for (const s of segments(game)) acc += Math.min(s.ms, Math.max(0, (t - s.start) * (BOOST_RATE - 1)));
  return acc;
}

export function effectiveTime(game: ScheduleGame, t: number): number {
  return t + (game.timeBonusMs ?? 0) + boostAccrued(game, t);
}

/** Index of the latest slot due at `now` (never negative). */
export function dueIndexAt(game: ScheduleGame, now: number): number {
  if (!Number.isFinite(now)) return 0;
  const e = effectiveTime(game, now);
  if (e < game.startedAt) return 0;
  return Math.floor((e - game.startedAt) / HOUR_MS);
}

/** Clock time at which slot `index` is due (inverse of effectiveTime). */
export function slotDueAt(game: ScheduleGame, index: number): number {
  const target = game.startedAt + index * HOUR_MS - (game.timeBonusMs ?? 0);
  let offset = 0; // accrued before the current segment
  for (const s of segments(game)) {
    if (target - offset <= s.start) return target - offset;
    const t = (target - offset + s.start * (BOOST_RATE - 1)) / BOOST_RATE;
    if (t <= s.end) return t;
    offset += s.ms;
  }
  return target - offset;
}

export function nextSlotDueAt(game: ScheduleGame & { lastProcessedGrowthIndex: number }): number {
  return slotDueAt(game, game.lastProcessedGrowthIndex + 1);
}

/** The pace-up running at `now`, if any: when it ends and how much it still saves. */
export function activeBoost(game: ScheduleGame, now: number): { endsAt: number; remainingMs: number } | null {
  const segs = segments(game);
  const running = segs.filter((s) => s.end > now);
  if (!running.length || running[0].start > now) return null;
  const endsAt = running[running.length - 1].end;
  return { endsAt, remainingMs: (endsAt - now) * (BOOST_RATE - 1) };
}

/** Effective time still queued in pace-ups that have not run yet (from `now`). */
export function pendingBoostMs(game: ScheduleGame, now: number): number {
  const total = (game.boosts ?? []).reduce((s, b) => s + b.ms, 0);
  return total - boostAccrued(game, now);
}
