import { Rng, hash32 } from './rng';

export type ItemKind = 'food' | 'toy';

export interface ItemDef {
  id: string;
  kind: ItemKind;
  name: string;
  icon: string;
  /** How much earlier the next growth comes (minutes). Items never add a dot. */
  minutes: number;
  rare: boolean;
}

/** 20 items: 10 foods (ごはん) and 10 toys (あそぶ). */
export const ITEMS: readonly ItemDef[] = [
  { id: 'candy', kind: 'food', name: 'キャンディ', icon: '🍬', minutes: 5, rare: false },
  { id: 'apple', kind: 'food', name: 'りんご', icon: '🍎', minutes: 10, rare: false },
  { id: 'banana', kind: 'food', name: 'バナナ', icon: '🍌', minutes: 10, rare: false },
  { id: 'strawberry', kind: 'food', name: 'いちご', icon: '🍓', minutes: 15, rare: false },
  { id: 'milk', kind: 'food', name: 'ミルク', icon: '🥛', minutes: 15, rare: false },
  { id: 'cookie', kind: 'food', name: 'クッキー', icon: '🍪', minutes: 20, rare: false },
  { id: 'onigiri', kind: 'food', name: 'おにぎり', icon: '🍙', minutes: 25, rare: false },
  { id: 'fish', kind: 'food', name: 'おさかな', icon: '🐟', minutes: 25, rare: false },
  { id: 'honey', kind: 'food', name: 'はちみつ', icon: '🍯', minutes: 30, rare: true },
  { id: 'cake', kind: 'food', name: 'ケーキ', icon: '🍰', minutes: 40, rare: true },
  { id: 'ribbon', kind: 'toy', name: 'リボン', icon: '🎀', minutes: 5, rare: false },
  { id: 'ball', kind: 'toy', name: 'ボール', icon: '⚽', minutes: 10, rare: false },
  { id: 'balloon', kind: 'toy', name: 'ふうせん', icon: '🎈', minutes: 10, rare: false },
  { id: 'dice', kind: 'toy', name: 'サイコロ', icon: '🎲', minutes: 15, rare: false },
  { id: 'yoyo', kind: 'toy', name: 'ヨーヨー', icon: '🪀', minutes: 15, rare: false },
  { id: 'crayon', kind: 'toy', name: 'おえかき', icon: '🎨', minutes: 20, rare: false },
  { id: 'puzzle', kind: 'toy', name: 'パズル', icon: '🧩', minutes: 20, rare: false },
  { id: 'kite', kind: 'toy', name: 'たこあげ', icon: '🪁', minutes: 25, rare: false },
  { id: 'musicbox', kind: 'toy', name: 'オルゴール', icon: '🎵', minutes: 30, rare: true },
  { id: 'teddy', kind: 'toy', name: 'ぬいぐるみ', icon: '🧸', minutes: 40, rare: true },
];

export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((i) => [i.id, i]));

export type Inventory = Record<string, number>;

/** Given once, the first time the app runs, so the buttons can be tried right away. */
export const STARTER_PACK: Inventory = { apple: 3, cookie: 1, ball: 2, balloon: 1 };

export interface GiftEntry {
  itemId: string;
  count: number;
}

/**
 * The thank-you present a creature gives when it completes (721 dots).
 * Deterministic from the creature's seed: one food, one toy and one rare item.
 */
export function giftFor(initialSeed: number): GiftEntry[] {
  const r = new Rng(hash32(initialSeed, 'gift'));
  const common = (kind: ItemKind) => ITEMS.filter((i) => i.kind === kind && !i.rare);
  const food = r.pick(common('food'));
  const toy = r.pick(common('toy'));
  const rare = r.pick(ITEMS.filter((i) => i.rare));
  return [
    { itemId: food.id, count: 2 + r.int(2) },
    { itemId: toy.id, count: 2 + r.int(2) },
    { itemId: rare.id, count: 1 },
  ];
}

/** The next growth can be pulled at most this close to "now" — an item never adds a dot by itself. */
export const MIN_WAIT_AFTER_ITEM_MS = 60_000;
