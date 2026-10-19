import { Rng } from './rng';
import { STAT_MAX, TOTAL_MAX, type Stats } from './stats';

/*
 * Stickers (シール): won from the medal gacha, one can be put on each
 * creature. They change its look a little (a badge on the body) and some
 * raise its abilities slightly — never by much:
 *   ★1 look only / ★2 one stat +2 (or HP / stamina +6) /
 *   ★3 one stat +3 (or HP / stamina +10) / ★4 two stats (+3 and +2).
 * The ability total still never goes over 150.
 */
export type Rarity = 1 | 2 | 3 | 4;

export interface StickerDef {
  id: string;
  name: string;
  icon: string;
  rarity: Rarity;
  /** Added to the stats (empty for ★1). */
  bonus: Partial<Stats>;
}

const S = (id: string, name: string, icon: string, rarity: Rarity, bonus: Partial<Stats> = {}): StickerDef => ({ id, name, icon, rarity, bonus });

export const STICKERS: readonly StickerDef[] = [
  // ★1: look only
  S('star', 'ほし', '⭐', 1), S('heart', 'ハート', '❤️', 1), S('blossom', 'さくら', '🌸', 1), S('clover', 'クローバー', '🍀', 1),
  S('rainbow', 'にじ', '🌈', 1), S('drop', 'しずく', '💧', 1), S('note', 'おんぷ', '🎵', 1), S('ribbon', 'リボン', '🎀', 1),
  S('butterfly', 'ちょうちょ', '🦋', 1), S('mushroom', 'きのこ', '🍄', 1), S('cherry', 'さくらんぼ', '🍒', 1), S('moon', 'つき', '🌙', 1),
  S('cloud', 'くも', '☁️', 1), S('snowman', 'ゆきだるま', '⛄', 1), S('umbrella', 'かさ', '☂️', 1), S('balloon', 'ふうせん', '🎈', 1),
  S('donut', 'ドーナツ', '🍩', 1), S('lollipop', 'ぺろぺろキャンディ', '🍭', 1), S('fishy', 'おさかな', '🐟', 1), S('paw', 'あしあと', '🐾', 1),
  // ★2: one small boost
  S('flame', 'ほのお', '🔥', 2, { strength: 2 }), S('fist', 'こぶし', '👊', 2, { strength: 2 }), S('pepper', 'とうがらし', '🌶️', 2, { strength: 2 }),
  S('shield', 'たて', '🛡️', 2, { defense: 2 }), S('rock', 'いわ', '🪨', 2, { defense: 2 }), S('turtle', 'かめ', '🐢', 2, { defense: 2 }),
  S('bolt', 'いなずま', '⚡', 2, { speed: 2 }), S('rocket', 'ロケット', '🚀', 2, { speed: 2 }), S('feather', 'はね', '🪶', 2, { speed: 2 }),
  S('dice', 'サイコロ', '🎲', 2, { luck: 2 }), S('coin', 'コイン', '🪙', 2, { luck: 2 }), S('bell', 'すず', '🔔', 2, { luck: 2 }),
  S('meat', 'おにく', '🍖', 2, { hp: 6 }), S('riceball', 'おにぎり', '🍙', 2, { stamina: 6 }), S('juice', 'ジュース', '🧃', 2, { stamina: 6 }),
  // ★3: one bigger boost
  S('dragon', 'りゅう', '🐉', 3, { strength: 3 }), S('lion', 'ライオン', '🦁', 3, { strength: 3 }),
  S('castle', 'おしろ', '🏰', 3, { defense: 3 }), S('hedgehog', 'はりねずみ', '🦔', 3, { defense: 3 }),
  S('cheetah', 'チーター', '🐆', 3, { speed: 3 }), S('eagle', 'わし', '🦅', 3, { speed: 3 }),
  S('shootingstar', 'ながれぼし', '🌠', 3, { luck: 3 }), S('blackcat', 'くろねこ', '🐈‍⬛', 3, { luck: 3 }),
  S('muscle', 'ちからこぶ', '💪', 3, { hp: 10 }), S('battery', 'でんち', '🔋', 3, { stamina: 10 }),
  // ★4: two boosts
  S('crown', 'おうかん', '👑', 4, { strength: 3, defense: 2 }), S('sword', 'けん', '⚔️', 4, { strength: 3, speed: 2 }),
  S('galaxy', 'ぎんが', '🌌', 4, { defense: 3, speed: 2 }), S('unicorn', 'ユニコーン', '🦄', 4, { speed: 3, luck: 2 }),
  S('crystal', 'すいしょう', '🔮', 4, { luck: 3, strength: 2 }),
];

export const STICKER_BY_ID: ReadonlyMap<string, StickerDef> = new Map(STICKERS.map((s) => [s.id, s]));

export const RARITY_LABEL: Record<Rarity, string> = { 1: 'ノーマル', 2: 'レア', 3: 'スーパーレア', 4: 'ウルトラレア' };
export const rarityStars = (r: Rarity) => '★'.repeat(r);

/** Gacha odds per rarity (shown on the gacha screen). */
export const GACHA_RATES: Record<Rarity, number> = { 4: 0.02, 3: 0.1, 2: 0.28, 1: 0.6 };
export const GACHA_COST = 10;
export const GACHA_TEN_COST = 100;

/** One gacha draw: a rarity by the odds, then a sticker of that rarity evenly. */
export function drawSticker(r: Rng): StickerDef {
  let u = r.next();
  let rarity: Rarity = 1;
  for (const k of [4, 3, 2, 1] as Rarity[]) {
    if (u < GACHA_RATES[k]) {
      rarity = k;
      break;
    }
    u -= GACHA_RATES[k];
  }
  return r.pick(STICKERS.filter((s) => s.rarity === rarity));
}

/** Short description of a sticker's effect. */
export function bonusText(s: StickerDef): string {
  const label: Record<keyof Stats, string> = { hp: 'HP', stamina: 'スタミナ', strength: 'つよさ', defense: 'まもり', speed: 'すばやさ', luck: '運' };
  const parts = (Object.keys(s.bonus) as (keyof Stats)[]).map((k) => `${label[k]}+${s.bonus[k]}`);
  return parts.length ? parts.join(' ') : '見た目だけ';
}

/** Stats with a sticker's bonus; the four core stats never exceed the ability total cap. */
export function withSticker(stats: Stats, stickerId: string | null | undefined): Stats {
  const s = stickerId ? STICKER_BY_ID.get(stickerId) : undefined;
  if (!s) return stats;
  const out = { ...stats };
  out.hp = Math.min(STAT_MAX.hp, out.hp + (s.bonus.hp ?? 0));
  out.stamina = Math.min(STAT_MAX.stamina, out.stamina + (s.bonus.stamina ?? 0));
  let room = TOTAL_MAX - (out.strength + out.defense + out.speed + out.luck);
  for (const k of ['strength', 'defense', 'speed', 'luck'] as const) {
    const add = Math.max(0, Math.min(s.bonus[k] ?? 0, room));
    out[k] += add;
    room -= add;
  }
  return out;
}

/** Medals from battles. Wild-dot wins give a few a day; ranked battles always give some. */
export const MEDALS = { wildWin: 1, wildDailyCap: 10, rankedWin: 3, rankedOther: 1 } as const;
