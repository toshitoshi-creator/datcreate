import { SAVE_FORMAT, SCHEMA_VERSION } from '../core/constants';
import { STARTER_PACK, type GiftEntry, type Inventory } from '../core/items';
import { sortMilestones } from '../core/milestones';
import type { RankedRecord } from '../core/ranked';
import type { EnvironmentLog, GameState, Milestone, Pixel } from '../core/types';
import { STORES, openDatabase, reqToPromise, txDone } from './db';
import { validateSave, type SaveFile } from './saveFile';

const ACTIVE_KEY = 'activeGameId';
const INVENTORY_KEY = 'inventory';
/** Coins bought with real money. Never touched by reset or import. */
const WALLET_KEY = 'wallet';
/** Store transactions already credited (so a re-delivered purchase is never counted twice). */
const PURCHASES_KEY = 'purchases';
/** Rewarded ads watched today: { day, count }. */
const AD_REWARD_KEY = 'adRewards';
/** Practice ranked battles: the RankedRecord, and the representative's gameId. */
const RANKED_KEY = 'ranked';
/** Medals from battles: { count, day, wildToday }. */
const MEDALS_KEY = 'medals';
/** Sticker counts not on a creature: { counts }. */
const STICKERS_KEY = 'stickers';
const CHAMPION_KEY = 'champion';
const BATTLE_REWARD_KEY = 'battleReward';

export class GrowthConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrowthConflictError';
  }
}

export class FutureSchemaError extends Error {
  constructor(version: number) {
    super(`このデータは新しいバージョン(v${version})で作成されています。アプリを更新してください。`);
    this.name = 'FutureSchemaError';
  }
}

/** Data migrations for stored GameState records (keyed by from-version). */
export const GAME_MIGRATIONS: Record<number, (g: GameState) => GameState> = {};

/**
 * Persistence layer. UI-independent; every multi-record write happens in a
 * single IndexedDB transaction so a crash never leaves half-written growth.
 */
export class GameRepository {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, name?: string): Promise<GameRepository> {
    return new GameRepository(await openDatabase(factory, name));
  }

  close() {
    this.db.close();
  }

  private tx(stores: string[], mode: IDBTransactionMode = 'readonly') {
    return this.db.transaction(stores, mode);
  }

  async getActiveGame(): Promise<GameState | null> {
    const tx = this.tx([STORES.meta, STORES.games], 'readwrite');
    const meta = await reqToPromise(tx.objectStore(STORES.meta).get(ACTIVE_KEY));
    if (!meta) {
      await txDone(tx);
      return null;
    }
    let game = (await reqToPromise(tx.objectStore(STORES.games).get(meta.value))) as GameState | undefined;
    if (game && game.schemaVersion > SCHEMA_VERSION) {
      await txDone(tx);
      throw new FutureSchemaError(game.schemaVersion);
    }
    if (game && game.schemaVersion < SCHEMA_VERSION) {
      let g: GameState = game;
      while (g.schemaVersion < SCHEMA_VERSION) {
        const step: ((g: GameState) => GameState) | undefined = GAME_MIGRATIONS[g.schemaVersion];
        if (!step) throw new Error(`No migration from schema v${g.schemaVersion}`);
        g = { ...step(g), schemaVersion: g.schemaVersion + 1 };
      }
      game = g;
      tx.objectStore(STORES.games).put(g);
    }
    await txDone(tx);
    return game ?? null;
  }

  async getGame(gameId: string): Promise<GameState | null> {
    const tx = this.tx([STORES.games]);
    const g = await reqToPromise(tx.objectStore(STORES.games).get(gameId));
    return (g as GameState) ?? null;
  }

  async createGame(game: GameState, first: Pixel, env: EnvironmentLog | null): Promise<void> {
    const tx = this.tx([STORES.games, STORES.pixels, STORES.meta, STORES.environment], 'readwrite');
    tx.objectStore(STORES.games).add(game);
    tx.objectStore(STORES.pixels).add(first);
    if (env) tx.objectStore(STORES.environment).put(env);
    tx.objectStore(STORES.meta).put({ key: ACTIVE_KEY, value: game.gameId });
    await txDone(tx);
  }

  /** All pixels of a game in growthIndex order, loaded in one bulk request. */
  async loadPixels(gameId: string, fromIndex = 0): Promise<Pixel[]> {
    const tx = this.tx([STORES.pixels]);
    const range = IDBKeyRange.bound([gameId, fromIndex], [gameId, Number.MAX_SAFE_INTEGER]);
    return (await reqToPromise(tx.objectStore(STORES.pixels).index('byGameIndex').getAll(range))) as Pixel[];
  }

  async countPixels(gameId: string): Promise<number> {
    const tx = this.tx([STORES.pixels]);
    const range = IDBKeyRange.bound([gameId, 0], [gameId, Number.MAX_SAFE_INTEGER]);
    return reqToPromise(tx.objectStore(STORES.pixels).index('byGameIndex').count(range));
  }

  /**
   * Atomically appends consecutive growth slots and advances
   * lastProcessedGrowthIndex. Aborts (writing nothing) if another writer
   * already processed these slots, so a slot can never be generated twice.
   */
  async appendGrowth(
    gameId: string,
    expectedLastIndex: number,
    pixels: Pixel[],
    milestones: Milestone[],
    observedAt: number,
  ): Promise<GameState> {
    if (!pixels.length) throw new Error('appendGrowth: no pixels');
    const tx = this.tx([STORES.games, STORES.pixels, STORES.milestones], 'readwrite');
    const games = tx.objectStore(STORES.games);
    const game = (await reqToPromise(games.get(gameId))) as GameState | undefined;
    const fail = (msg: string) => {
      try { tx.abort(); } catch { /* already finished */ }
      return new GrowthConflictError(msg);
    };
    if (!game) throw fail('game not found');
    if (game.lastProcessedGrowthIndex !== expectedLastIndex) {
      throw fail(`expected last index ${expectedLastIndex}, found ${game.lastProcessedGrowthIndex}`);
    }
    pixels.forEach((p, i) => {
      if (p.growthIndex !== expectedLastIndex + 1 + i || p.gameId !== gameId) throw fail('non-consecutive pixels');
    });
    const store = tx.objectStore(STORES.pixels);
    for (const p of pixels) store.add(p); // add (not put): an existing id aborts the tx
    const ms = tx.objectStore(STORES.milestones);
    for (const m of milestones) ms.put(m);
    const updated: GameState = {
      ...game,
      lastProcessedGrowthIndex: pixels[pixels.length - 1].growthIndex,
      updatedAt: observedAt,
      lastObservedAt: Math.max(game.lastObservedAt, observedAt),
    };
    games.put(updated);
    await txDone(tx);
    return updated;
  }

  async updateObservedAt(gameId: string, observedAt: number): Promise<void> {
    const tx = this.tx([STORES.games], 'readwrite');
    const store = tx.objectStore(STORES.games);
    const game = (await reqToPromise(store.get(gameId))) as GameState | undefined;
    if (game) store.put({ ...game, lastObservedAt: observedAt });
    await txDone(tx);
  }

  /** Update flags on a game record (never its pixels or growth index). */
  async updateGameFlags(gameId: string, patch: Pick<GameState, 'keepGrowing'>): Promise<GameState | null> {
    const tx = this.tx([STORES.games], 'readwrite');
    const store = tx.objectStore(STORES.games);
    const game = (await reqToPromise(store.get(gameId))) as GameState | undefined;
    if (!game) {
      await txDone(tx);
      return null;
    }
    const updated = { ...game, ...patch };
    store.put(updated);
    await txDone(tx);
    return updated;
  }

  /**
   * Move the active creature to the collection: it keeps all its dots and
   * history, stops growing, and the app returns to the start screen.
   */
  async archiveActiveGame(now: number, name: string): Promise<GameState | null> {
    const tx = this.tx([STORES.games, STORES.meta], 'readwrite');
    const meta = await reqToPromise(tx.objectStore(STORES.meta).get(ACTIVE_KEY));
    let archived: GameState | null = null;
    if (meta?.value) {
      const games = tx.objectStore(STORES.games);
      const game = (await reqToPromise(games.get(meta.value))) as GameState | undefined;
      if (game) {
        archived = { ...game, archivedAt: now, updatedAt: now, name };
        games.put(archived);
      }
    }
    tx.objectStore(STORES.meta).delete(ACTIVE_KEY);
    await txDone(tx);
    return archived;
  }

  /** Creatures in the collection, newest first. */
  async listArchivedGames(): Promise<GameState[]> {
    const tx = this.tx([STORES.games]);
    const all = (await reqToPromise(tx.objectStore(STORES.games).getAll())) as GameState[];
    return all.filter((g) => g.archivedAt !== undefined).sort((a, b) => b.archivedAt! - a.archivedAt!);
  }

  /** Rename a creature in the collection. Duplicate names are allowed. */
  async renameArchivedGame(gameId: string, name: string): Promise<GameState> {
    const tx = this.tx([STORES.games], 'readwrite');
    const store = tx.objectStore(STORES.games);
    const game = (await reqToPromise(store.get(gameId))) as GameState | undefined;
    if (!game || game.archivedAt === undefined) {
      try { tx.abort(); } catch { /* already finished */ }
      throw new Error('図鑑の個体ではありません');
    }
    const updated = { ...game, name };
    store.put(updated);
    await txDone(tx);
    return updated;
  }

  /** Delete one creature from the collection (never the active one). */
  async deleteArchivedGame(gameId: string): Promise<void> {
    const tx = this.tx([STORES.games, STORES.pixels, STORES.environment, STORES.milestones, STORES.meta], 'readwrite');
    const meta = await reqToPromise(tx.objectStore(STORES.meta).get(ACTIVE_KEY));
    const game = (await reqToPromise(tx.objectStore(STORES.games).get(gameId))) as GameState | undefined;
    if (meta?.value === gameId || !game || game.archivedAt === undefined) {
      try { tx.abort(); } catch { /* already finished */ }
      throw new Error('図鑑の個体ではありません');
    }
    await this.returnStickerInTx(tx, gameId);
    await this.deleteGameInTx(tx, gameId);
    const champ = await reqToPromise(tx.objectStore(STORES.meta).get(CHAMPION_KEY));
    if (champ?.value === gameId) tx.objectStore(STORES.meta).delete(CHAMPION_KEY);
    await txDone(tx);
  }

  /** Inside a transaction: put a deleted game's sticker back into the stock. */
  private async returnStickerInTx(tx: IDBTransaction, gameId: string): Promise<void> {
    const game = (await reqToPromise(tx.objectStore(STORES.games).get(gameId))) as GameState | undefined;
    if (!game?.sticker) return;
    const meta = tx.objectStore(STORES.meta);
    const st = (await reqToPromise(meta.get(STICKERS_KEY))) as { counts: Record<string, number>; seen?: string[] } | undefined;
    const counts = { ...(st?.counts ?? {}) };
    counts[game.sticker] = (counts[game.sticker] ?? 0) + 1;
    meta.put({ key: STICKERS_KEY, counts, seen: st?.seen ?? [] });
  }

  // ---- medals, gacha & stickers --------------------------------------------------

  async getMedalsAndStickers(): Promise<{ medals: number; stickers: Record<string, number>; stickersSeen: string[] }> {
    const tx = this.tx([STORES.meta]);
    const meta = tx.objectStore(STORES.meta);
    const m = (await reqToPromise(meta.get(MEDALS_KEY))) as { count: number } | undefined;
    const st = (await reqToPromise(meta.get(STICKERS_KEY))) as { counts: Record<string, number>; seen?: string[] } | undefined;
    await txDone(tx);
    return { medals: m?.count ?? 0, stickers: st?.counts ?? {}, stickersSeen: st?.seen ?? [] };
  }

  /**
   * Add medals for a battle. Wild-dot wins are limited to `wildCap` medals a
   * day (`wild`: true); ranked battles are already limited by their own count.
   */
  async addMedals(n: number, day: string, wild: boolean, wildCap: number): Promise<{ medals: number; gained: number }> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const m = ((await reqToPromise(meta.get(MEDALS_KEY))) as { count: number; day: string; wildToday: number } | undefined) ?? { count: 0, day, wildToday: 0 };
    const wildToday = m.day === day ? m.wildToday : 0;
    const gained = wild ? Math.max(0, Math.min(n, wildCap - wildToday)) : n;
    const next = { key: MEDALS_KEY, count: m.count + gained, day, wildToday: wildToday + (wild ? gained : 0) };
    meta.put(next);
    await txDone(tx);
    return { medals: next.count, gained };
  }

  /** Spend medals and receive the drawn stickers, atomically. */
  async pullGacha(cost: number, stickerIds: string[]): Promise<{ medals: number; stickers: Record<string, number>; stickersSeen: string[] }> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const m = (await reqToPromise(meta.get(MEDALS_KEY))) as { count: number; day: string; wildToday: number } | undefined;
    const st = (await reqToPromise(meta.get(STICKERS_KEY))) as { counts: Record<string, number>; seen?: string[] } | undefined;
    if (!m || m.count < cost) {
      try { tx.abort(); } catch { /* already finished */ }
      throw new Error('メダルが足りません');
    }
    const counts = { ...(st?.counts ?? {}) };
    for (const id of stickerIds) counts[id] = (counts[id] ?? 0) + 1;
    const seen = [...new Set([...(st?.seen ?? []), ...stickerIds])];
    meta.put({ ...m, key: MEDALS_KEY, count: m.count - cost });
    meta.put({ key: STICKERS_KEY, counts, seen });
    await txDone(tx);
    return { medals: m.count - cost, stickers: counts, stickersSeen: seen };
  }

  /**
   * Put a sticker on a creature (or take it off with null). The sticker it
   * had goes back to the stock; the new one is taken from it. Atomic.
   */
  async setSticker(gameId: string, stickerId: string | null): Promise<{ game: GameState; stickers: Record<string, number> }> {
    const tx = this.tx([STORES.meta, STORES.games], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const games = tx.objectStore(STORES.games);
    const game = (await reqToPromise(games.get(gameId))) as GameState | undefined;
    const st = (await reqToPromise(meta.get(STICKERS_KEY))) as { counts: Record<string, number>; seen?: string[] } | undefined;
    const counts = { ...(st?.counts ?? {}) };
    const fail = (msg: string) => {
      try { tx.abort(); } catch { /* already finished */ }
      return new Error(msg);
    };
    if (!game) throw fail('個体が見つかりません');
    if (game.sticker) counts[game.sticker] = (counts[game.sticker] ?? 0) + 1;
    if (stickerId) {
      if (!(counts[stickerId] > 0)) throw fail('そのシールを持っていません');
      counts[stickerId] -= 1;
    }
    for (const k of Object.keys(counts)) if (counts[k] <= 0) delete counts[k];
    const { sticker: _old, ...rest } = game;
    const updated: GameState = stickerId ? { ...rest, sticker: stickerId } : rest;
    games.put(updated);
    meta.put({ key: STICKERS_KEY, counts, seen: st?.seen ?? [] });
    await txDone(tx);
    return { game: updated, stickers: counts };
  }

  // ---- practice ranked battles ------------------------------------------------

  async getChampion(): Promise<string | null> {
    const tx = this.tx([STORES.meta]);
    const rec = await reqToPromise(tx.objectStore(STORES.meta).get(CHAMPION_KEY));
    await txDone(tx);
    return (rec?.value as string | undefined) ?? null;
  }

  /** Choose the representative: a finished creature from the collection. */
  async setChampion(gameId: string, minDots: number): Promise<void> {
    const tx = this.tx([STORES.games, STORES.meta], 'readwrite');
    const game = (await reqToPromise(tx.objectStore(STORES.games).get(gameId))) as GameState | undefined;
    if (!game || game.archivedAt === undefined || game.lastProcessedGrowthIndex + 1 < minDots) {
      try { tx.abort(); } catch { /* already finished */ }
      throw new Error('代表にできるのは、図鑑にいる完成した子だけです');
    }
    tx.objectStore(STORES.meta).put({ key: CHAMPION_KEY, value: gameId });
    await txDone(tx);
  }

  async getRanked(): Promise<RankedRecord | null> {
    const tx = this.tx([STORES.meta]);
    const rec = await reqToPromise(tx.objectStore(STORES.meta).get(RANKED_KEY));
    await txDone(tx);
    return (rec?.record as RankedRecord | undefined) ?? null;
  }

  /**
   * Read-modify-write the ranked record in one transaction (safe across tabs).
   * `coins` > 0 also adds a season reward to the wallet atomically.
   */
  async updateRanked(fn: (rec: RankedRecord | null) => { rec: RankedRecord; coins?: number }): Promise<{ rec: RankedRecord; wallet: number }> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const cur = ((await reqToPromise(meta.get(RANKED_KEY)))?.record as RankedRecord | undefined) ?? null;
    let wallet = ((await reqToPromise(meta.get(WALLET_KEY))) as { coins: number } | undefined)?.coins ?? 0;
    let out: { rec: RankedRecord; coins?: number };
    try {
      out = fn(cur);
    } catch (e) {
      try { tx.abort(); } catch { /* already finished */ }
      throw e;
    }
    meta.put({ key: RANKED_KEY, record: out.rec });
    if (out.coins && out.coins > 0) {
      wallet += out.coins;
      meta.put({ key: WALLET_KEY, coins: wallet });
    }
    await txDone(tx);
    return { rec: out.rec, wallet };
  }

  // ---- items ---------------------------------------------------------------

  /** Item counts shared by all creatures. The starter pack is added the first time. */
  async getInventory(): Promise<Inventory> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const store = tx.objectStore(STORES.meta);
    const rec = (await reqToPromise(store.get(INVENTORY_KEY))) as { key: string; counts: Inventory } | undefined;
    let counts = rec?.counts;
    if (!counts) {
      counts = { ...STARTER_PACK };
      store.put({ key: INVENTORY_KEY, counts });
    }
    await txDone(tx);
    return counts;
  }

  /**
   * Use one item: decrement the stock and pull the creature's schedule
   * forward by `ms`, in one transaction (never one without the other).
   */
  async useItem(gameId: string, itemId: string, ms: number, now: number): Promise<{ game: GameState; inventory: Inventory }> {
    const tx = this.tx([STORES.meta, STORES.games], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const games = tx.objectStore(STORES.games);
    const rec = (await reqToPromise(meta.get(INVENTORY_KEY))) as { key: string; counts: Inventory } | undefined;
    const game = (await reqToPromise(games.get(gameId))) as GameState | undefined;
    const fail = (msg: string) => {
      try { tx.abort(); } catch { /* already finished */ }
      return new Error(msg);
    };
    const counts = { ...(rec?.counts ?? STARTER_PACK) };
    if (!game || game.archivedAt !== undefined) throw fail('育てている子がいません');
    if (!(counts[itemId] > 0)) throw fail('そのアイテムを持っていません');
    if (!(ms > 0)) throw fail('今は使えません');
    counts[itemId] -= 1;
    if (counts[itemId] === 0) delete counts[itemId];
    const uses = [...(game.itemUses ?? []), { itemId, at: now, ms }].slice(-200);
    const updated: GameState = { ...game, timeBonusMs: (game.timeBonusMs ?? 0) + ms, itemUses: uses, updatedAt: now };
    meta.put({ key: INVENTORY_KEY, counts });
    games.put(updated);
    await txDone(tx);
    return { game: updated, inventory: counts };
  }

  async getCoins(): Promise<number> {
    const tx = this.tx([STORES.meta]);
    const rec = (await reqToPromise(tx.objectStore(STORES.meta).get(WALLET_KEY))) as { coins: number } | undefined;
    await txDone(tx);
    return rec?.coins ?? 0;
  }

  /**
   * Credit a store purchase. Idempotent per transaction: the store may deliver
   * the same purchase again (e.g. the app closed before it was finished).
   */
  async creditPurchase(transactionId: string, productId: string, coins: number, now: number): Promise<{ coins: number; fresh: boolean }> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const wallet = ((await reqToPromise(meta.get(WALLET_KEY))) as { coins: number } | undefined)?.coins ?? 0;
    const done = ((await reqToPromise(meta.get(PURCHASES_KEY))) as { list: { transactionId: string }[] } | undefined)?.list ?? [];
    if (done.some((p) => p.transactionId === transactionId)) {
      await txDone(tx);
      return { coins: wallet, fresh: false };
    }
    const next = wallet + coins;
    meta.put({ key: WALLET_KEY, coins: next });
    meta.put({ key: PURCHASES_KEY, list: [...done, { transactionId, productId, coins, at: now }] });
    await txDone(tx);
    return { coins: next, fresh: true };
  }

  /** Rewarded ads watched on `day` (local day key). */
  async adRewardsOn(day: string): Promise<number> {
    const tx = this.tx([STORES.meta]);
    const rec = (await reqToPromise(tx.objectStore(STORES.meta).get(AD_REWARD_KEY))) as { day: string; count: number } | undefined;
    await txDone(tx);
    return rec?.day === day ? rec.count : 0;
  }

  /** Coins for a watched ad, at most `limit` times a day. Null when today's limit is reached. */
  async creditAdReward(day: string, coins: number, limit: number): Promise<{ coins: number; watched: number } | null> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const rec = (await reqToPromise(meta.get(AD_REWARD_KEY))) as { day: string; count: number } | undefined;
    const watched = rec?.day === day ? rec.count : 0;
    if (watched >= limit) {
      await txDone(tx);
      return null;
    }
    const wallet = ((await reqToPromise(meta.get(WALLET_KEY))) as { coins: number } | undefined)?.coins ?? 0;
    meta.put({ key: WALLET_KEY, coins: wallet + coins });
    meta.put({ key: AD_REWARD_KEY, day, count: watched + 1 });
    await txDone(tx);
    return { coins: wallet + coins, watched: watched + 1 };
  }

  /** Spend coins for one item, atomically. */
  async exchangeCoins(itemId: string, cost: number): Promise<{ coins: number; inventory: Inventory }> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const wallet = ((await reqToPromise(meta.get(WALLET_KEY))) as { coins: number } | undefined)?.coins ?? 0;
    const rec = (await reqToPromise(meta.get(INVENTORY_KEY))) as { key: string; counts: Inventory } | undefined;
    if (!(cost > 0) || wallet < cost) {
      try { tx.abort(); } catch { /* already finished */ }
      throw new Error('コインが足りません');
    }
    const counts = { ...(rec?.counts ?? STARTER_PACK) };
    counts[itemId] = (counts[itemId] ?? 0) + 1;
    meta.put({ key: WALLET_KEY, coins: wallet - cost });
    meta.put({ key: INVENTORY_KEY, counts });
    await txDone(tx);
    return { coins: wallet - cost, inventory: counts };
  }

  /** Start a pace-up: uses one item and appends it to the game's pace-ups. */
  async useBoost(gameId: string, boostId: string, ms: number, now: number): Promise<{ game: GameState; inventory: Inventory }> {
    const tx = this.tx([STORES.meta, STORES.games], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const games = tx.objectStore(STORES.games);
    const rec = (await reqToPromise(meta.get(INVENTORY_KEY))) as { key: string; counts: Inventory } | undefined;
    const game = (await reqToPromise(games.get(gameId))) as GameState | undefined;
    const fail = (msg: string) => {
      try { tx.abort(); } catch { /* already finished */ }
      return new Error(msg);
    };
    const counts = { ...(rec?.counts ?? STARTER_PACK) };
    if (!game || game.archivedAt !== undefined) throw fail('育てている子がいません');
    if (!(counts[boostId] > 0)) throw fail('そのアイテムを持っていません');
    if (!(ms > 0)) throw fail('今は使えません');
    counts[boostId] -= 1;
    if (counts[boostId] === 0) delete counts[boostId];
    const updated: GameState = { ...game, boosts: [...(game.boosts ?? []), { boostId, at: now, ms }], updatedAt: now };
    meta.put({ key: INVENTORY_KEY, counts });
    games.put(updated);
    await txDone(tx);
    return { game: updated, inventory: counts };
  }

  /** Receive a creature's thank-you present once; later calls return the stored one. */
  async claimGift(gameId: string, gift: GiftEntry[], now: number): Promise<{ game: GameState; inventory: Inventory; fresh: boolean }> {
    const tx = this.tx([STORES.meta, STORES.games], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const games = tx.objectStore(STORES.games);
    const rec = (await reqToPromise(meta.get(INVENTORY_KEY))) as { key: string; counts: Inventory } | undefined;
    const game = (await reqToPromise(games.get(gameId))) as GameState | undefined;
    const counts = { ...(rec?.counts ?? STARTER_PACK) };
    if (!game) {
      try { tx.abort(); } catch { /* already finished */ }
      throw new Error('個体が見つかりません');
    }
    if (game.giftClaimedAt !== undefined) {
      await txDone(tx);
      return { game, inventory: counts, fresh: false };
    }
    for (const g of gift) counts[g.itemId] = (counts[g.itemId] ?? 0) + g.count;
    const updated: GameState = { ...game, gift, giftClaimedAt: now };
    meta.put({ key: INVENTORY_KEY, counts });
    games.put(updated);
    await txDone(tx);
    return { game: updated, inventory: counts, fresh: true };
  }

  /**
   * Give the battle reward at most once per local day. Returns the new
   * inventory, or null when today's reward was already given.
   */
  async grantDailyBattleReward(dayKey: string, itemId: string): Promise<Inventory | null> {
    const tx = this.tx([STORES.meta], 'readwrite');
    const meta = tx.objectStore(STORES.meta);
    const last = (await reqToPromise(meta.get(BATTLE_REWARD_KEY))) as { key: string; day: string } | undefined;
    if (last?.day === dayKey) {
      await txDone(tx);
      return null;
    }
    const rec = (await reqToPromise(meta.get(INVENTORY_KEY))) as { key: string; counts: Inventory } | undefined;
    const counts = { ...(rec?.counts ?? STARTER_PACK) };
    counts[itemId] = (counts[itemId] ?? 0) + 1;
    meta.put({ key: INVENTORY_KEY, counts });
    meta.put({ key: BATTLE_REWARD_KEY, day: dayKey });
    await txDone(tx);
    return counts;
  }

  async putMilestone(m: Milestone): Promise<void> {
    const tx = this.tx([STORES.milestones], 'readwrite');
    tx.objectStore(STORES.milestones).put(m);
    await txDone(tx);
  }

  async loadMilestones(gameId: string): Promise<Milestone[]> {
    const tx = this.tx([STORES.milestones]);
    const all = (await reqToPromise(tx.objectStore(STORES.milestones).index('byGame').getAll(gameId))) as Milestone[];
    return sortMilestones(all);
  }

  async putEnvironmentLog(log: EnvironmentLog): Promise<void> {
    const tx = this.tx([STORES.environment], 'readwrite');
    tx.objectStore(STORES.environment).put(log);
    await txDone(tx);
  }

  /** Most recent environment logs (newest last). */
  async recentEnvironmentLogs(limit = 48): Promise<EnvironmentLog[]> {
    const tx = this.tx([STORES.environment]);
    const out: EnvironmentLog[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = tx.objectStore(STORES.environment).index('byCapturedAt').openCursor(null, 'prev');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) return resolve();
        out.push(cur.value as EnvironmentLog);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out.reverse();
  }

  async getEnvironmentLog(id: string): Promise<EnvironmentLog | null> {
    const tx = this.tx([STORES.environment]);
    return ((await reqToPromise(tx.objectStore(STORES.environment).get(id))) as EnvironmentLog) ?? null;
  }

  async exportSave(gameId: string, now: number): Promise<SaveFile> {
    const tx = this.tx([STORES.games, STORES.pixels, STORES.environment, STORES.milestones]);
    const game = (await reqToPromise(tx.objectStore(STORES.games).get(gameId))) as GameState;
    const range = IDBKeyRange.bound([gameId, 0], [gameId, Number.MAX_SAFE_INTEGER]);
    const pixels = (await reqToPromise(tx.objectStore(STORES.pixels).index('byGameIndex').getAll(range))) as Pixel[];
    const environmentLogs = (await reqToPromise(tx.objectStore(STORES.environment).index('byGame').getAll(gameId))) as EnvironmentLog[];
    const milestones = (await reqToPromise(tx.objectStore(STORES.milestones).index('byGame').getAll(gameId))) as Milestone[];
    return { format: SAVE_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: now, game, pixels, environmentLogs, milestones };
  }

  /**
   * Replace the active game with validated save data. Validation runs before
   * any write, and the replacement happens in one transaction: if anything
   * fails, the existing save is left untouched.
   */
  async importSave(input: unknown): Promise<GameState> {
    const result = validateSave(input);
    if (!result.ok) throw new Error(result.errors.join('\n'));
    const { save } = result;
    const tx = this.tx([STORES.games, STORES.pixels, STORES.environment, STORES.milestones, STORES.meta], 'readwrite');
    const meta = await reqToPromise(tx.objectStore(STORES.meta).get(ACTIVE_KEY));
    const ids = new Set<string>([save.game.gameId]);
    if (meta?.value) ids.add(meta.value as string);
    if (meta?.value && meta.value !== save.game.gameId) await this.returnStickerInTx(tx, meta.value as string);
    for (const id of ids) await this.deleteGameInTx(tx, id);
    tx.objectStore(STORES.games).put(save.game);
    const ps = tx.objectStore(STORES.pixels);
    for (const p of save.pixels) ps.put(p);
    const es = tx.objectStore(STORES.environment);
    for (const e of save.environmentLogs) es.put(e);
    const ms = tx.objectStore(STORES.milestones);
    for (const m of save.milestones) ms.put(m);
    tx.objectStore(STORES.meta).put({ key: ACTIVE_KEY, value: save.game.gameId });
    await txDone(tx);
    return save.game;
  }

  /**
   * Delete a game and everything that belongs to it, inside `tx`. Resolves
   * once every delete is issued, so callers can write a game with the same
   * id afterwards without the cursors removing the new records.
   */
  private deleteGameInTx(tx: IDBTransaction, gameId: string): Promise<void> {
    tx.objectStore(STORES.games).delete(gameId);
    const sweep = (source: IDBIndex, range: IDBKeyRange, store: IDBObjectStore) =>
      new Promise<void>((resolve, reject) => {
        const req = source.openKeyCursor(range);
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          store.delete(cur.primaryKey);
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
    const pixels = tx.objectStore(STORES.pixels);
    // Pixel ids are `${gameId}:${index}`; delete via the index cursor.
    const jobs = [sweep(pixels.index('byGameIndex'), IDBKeyRange.bound([gameId, 0], [gameId, Number.MAX_SAFE_INTEGER]), pixels)];
    for (const name of [STORES.environment, STORES.milestones]) {
      const s = tx.objectStore(name);
      jobs.push(sweep(s.index('byGame'), IDBKeyRange.only(gameId), s));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /** Delete the active game entirely (after the UI confirmed it). */
  async resetActiveGame(): Promise<void> {
    const tx = this.tx([STORES.games, STORES.pixels, STORES.environment, STORES.milestones, STORES.meta], 'readwrite');
    const meta = await reqToPromise(tx.objectStore(STORES.meta).get(ACTIVE_KEY));
    if (meta?.value) {
      await this.returnStickerInTx(tx, meta.value as string);
      await this.deleteGameInTx(tx, meta.value as string);
    }
    // environment logs captured before a game existed
    const env = tx.objectStore(STORES.environment);
    const r = env.index('byGame').openKeyCursor(IDBKeyRange.only('none'));
    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) return;
      env.delete(cur.primaryKey);
      cur.continue();
    };
    tx.objectStore(STORES.meta).delete(ACTIVE_KEY);
    await txDone(tx);
  }
}
