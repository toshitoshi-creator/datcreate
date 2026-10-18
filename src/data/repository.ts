import { SAVE_FORMAT, SCHEMA_VERSION } from '../core/constants';
import { STARTER_PACK, type GiftEntry, type Inventory } from '../core/items';
import { sortMilestones } from '../core/milestones';
import type { EnvironmentLog, GameState, Milestone, Pixel } from '../core/types';
import { STORES, openDatabase, reqToPromise, txDone } from './db';
import { validateSave, type SaveFile } from './saveFile';

const ACTIVE_KEY = 'activeGameId';
const INVENTORY_KEY = 'inventory';
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
    this.deleteGameInTx(tx, gameId);
    await txDone(tx);
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
    for (const id of ids) this.deleteGameInTx(tx, id);
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

  private deleteGameInTx(tx: IDBTransaction, gameId: string) {
    tx.objectStore(STORES.games).delete(gameId);
    const range = IDBKeyRange.bound([gameId, 0], [gameId, Number.MAX_SAFE_INTEGER]);
    // Pixel ids are `${gameId}:${index}`; delete via the index cursor.
    const req = tx.objectStore(STORES.pixels).index('byGameIndex').openKeyCursor(range);
    const pixels = tx.objectStore(STORES.pixels);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      pixels.delete(cur.primaryKey);
      cur.continue();
    };
    for (const store of [STORES.environment, STORES.milestones]) {
      const s = tx.objectStore(store);
      const r = s.index('byGame').openKeyCursor(IDBKeyRange.only(gameId));
      r.onsuccess = () => {
        const cur = r.result;
        if (!cur) return;
        s.delete(cur.primaryKey);
        cur.continue();
      };
    }
  }

  /** Delete the active game entirely (after the UI confirmed it). */
  async resetActiveGame(): Promise<void> {
    const tx = this.tx([STORES.games, STORES.pixels, STORES.environment, STORES.milestones, STORES.meta], 'readwrite');
    const meta = await reqToPromise(tx.objectStore(STORES.meta).get(ACTIVE_KEY));
    if (meta?.value) this.deleteGameInTx(tx, meta.value as string);
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
