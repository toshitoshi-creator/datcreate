import { COMPLETE_GROWTH_INDEX } from './constants';
import { slotDueAt } from './schedule';
import type { GameState } from './types';

/**
 * When the creature will be finished (its 721st dot), or null when no
 * completion is ahead: no game, already finished, kept growing, or archived.
 * Growth is fixed by the schedule, so this is known in advance and can be
 * handed to the device as a local notification while the app is closed.
 */
export function completionNoticeAt(game: GameState | null): number | null {
  if (!game || game.archivedAt !== undefined || game.keepGrowing) return null;
  if (game.lastProcessedGrowthIndex >= COMPLETE_GROWTH_INDEX) return null;
  return slotDueAt(game, COMPLETE_GROWTH_INDEX);
}
