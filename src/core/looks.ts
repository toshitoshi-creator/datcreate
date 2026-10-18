import type { CreatureStyle } from './genome';
import { hash32 } from './rng';
import { COOL_SPECIES, CUTE_SPECIES, type Species } from './species';

/**
 * Player choice -> concrete look. 'cute' / 'cool' become one of that family's
 * looks: the plain look, its ghost, or one of its animals. 'random' picks a
 * family first. Concrete styles (tests, imports) pass through unchanged.
 */
export function resolveStyle(choice: StyleChoice, initialSeed: number): { style: CreatureStyle; species?: Species } {
  const roll = hash32(initialSeed, 'style') % 1000;
  const family = choice === 'random' ? (roll % 2 ? 'cool' : 'cute') : choice;
  if (family !== 'cute' && family !== 'cool') return { style: family };
  const r = Math.floor(roll / 2) % 100; // independent of the family bit
  if (family === 'cute') {
    if (r < 18) return { style: 'cute' };
    if (r < 32) return { style: 'ghost' };
    return { style: 'cute', species: CUTE_SPECIES[(r - 32) % CUTE_SPECIES.length] };
  }
  if (r < 16) return { style: 'cool' };
  if (r < 30) return { style: 'ghostCool' };
  return { style: 'cool', species: COOL_SPECIES[(r - 30) % COOL_SPECIES.length] };
}

export type StyleChoice = 'cute' | 'cool' | 'random' | CreatureStyle;
