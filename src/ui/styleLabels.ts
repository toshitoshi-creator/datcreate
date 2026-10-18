import type { CreatureStyle } from '../core/genome';
import { SPECIES_LABEL, type Species } from '../core/species';

export const STYLE_LABEL: Record<CreatureStyle, string> = {
  cute: 'かわいい',
  cool: 'かっこいい',
  ghost: 'かわいい・おばけ',
  ghostCool: 'かっこいい・おばけ',
};

/** e.g. "かわいい・くま", "かっこいい・おばけ", "かわいい". */
export function lookLabel(game: { style?: CreatureStyle; species?: Species }): string {
  const style = game.style ?? 'cute';
  if (game.species) return `${STYLE_LABEL[style]}・${SPECIES_LABEL[game.species]}`;
  return STYLE_LABEL[style];
}
