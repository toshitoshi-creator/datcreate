import { CLOCK_ROLLBACK_TOLERANCE_MS, COMPLETE_GROWTH_INDEX, HOUR_MS, SLOT_MS, CURRENT_GENERATOR_VERSION, NAME_MAX_LENGTH, SCHEMA_VERSION, WEATHER_VALID_MS } from '../core/constants';
import { Simulation } from '../core/generator';
import { detectMilestones, sortMilestones } from '../core/milestones';
import { Rng, freshSeed, hash32 } from '../core/rng';
import { resolveStyle, type StyleChoice } from '../core/looks';
import { timeOfDayFromHour } from '../core/time';
import { BOOST_RATE, activeBoost, dotsPerDay, dueIndexAt, effectiveTime, pendingBoostMs, slotDueAt, slotMsOf } from '../core/schedule';
import { AD_DAILY_LIMIT, AD_REWARD_COINS, BOOST_BY_ID, COIN_PACK_BY_ID, boostMs, dayKey, type BoostDef } from '../core/shop';
import { ITEMS, ITEM_BY_ID, MIN_WAIT_AFTER_ITEM_MS, giftFor, type ItemDef, type Inventory } from '../core/items';
import { statsOf, type Stats } from '../core/stats';
import { rollGem } from '../core/gems';
import { GACHA_COST, MEDALS, drawSticker, withSticker, type StickerDef } from '../core/stickers';
import { simulateBattle, type BattleResult } from '../core/battle';
import { RANKED_DAILY_LIMIT, applyResult, freshRecord, makeRival, rollRecord, seasonOf, type RankTier, type RankedRecord, type Rival } from '../core/ranked';
import type { EnvUsed, EnvironmentLog, FetchStatus, GameState, Milestone, Pixel } from '../core/types';
import { GrowthConflictError, type GameRepository } from '../data/repository';
import type { SettingsStore } from '../data/settings';
import type { EnvironmentService } from '../services/environmentService';
import type { Clock } from './clock';
import type { PurchasePort } from './purchases';
import type { AdPort } from './ads';

export type ControllerStatus = 'loading' | 'no-game' | 'ready' | 'error';

export interface ControllerState {
  status: ControllerStatus;
  error: string | null;
  game: GameState | null;
  pixelCount: number;
  milestones: Milestone[];
  /** Most recent capture attempt (any status). */
  latestEnv: EnvironmentLog | null;
  /** Most recent successful weather capture, if still valid. */
  weatherLog: EnvironmentLog | null;
  catchUp: { done: number; total: number } | null;
  clockWarning: boolean;
  locationStatus: FetchStatus | null;
  /**
   * 'complete': reached completion (721 dots) and waits for the player's choice (growth is
   * paused); 'continuing': the player chose to keep growing.
   */
  completion: Completion;
  /** Item counts (shared by all creatures). */
  inventory: Inventory;
  /** Coins bought in the shop (shared by all creatures). */
  coins: number;
  /** How coins can be bought here: none (web), the real store, or the free trial store. */
  shop: 'none' | 'store' | 'test';
  /** Rewarded ads: none (web), real ads, or the pretend trial ad. */
  ads: 'none' | 'ads' | 'test';
  /** Rewarded ads still available today. */
  adsLeftToday: number;
  /** Medals won in battles (spent on the sticker gacha). */
  medals: number;
  /** Stickers in stock (not on a creature). */
  stickers: Record<string, number>;
  /** Every sticker ever drawn (the sticker book). */
  stickersSeen: string[];
}

export interface ReactionEvent {
  item: ItemDef;
  /** How much earlier the next growth now comes. */
  ms: number;
}

export type Completion = 'growing' | 'complete' | 'continuing';

export function completionOf(game: GameState | null): Completion {
  if (!game || game.lastProcessedGrowthIndex < COMPLETE_GROWTH_INDEX) return 'growing';
  return game.keepGrowing ? 'continuing' : 'complete';
}

/** Last slot that may be generated now: growth pauses at completion until the player decides. */

export type PixelReason = 'initial' | 'growth' | 'catchup';
export interface PixelEvent {
  pixels: readonly Pixel[];
  reason: PixelReason;
}

type LockFn = <T>(fn: () => Promise<T>) => Promise<T>;

export interface ControllerDeps {
  repo: GameRepository;
  environment: EnvironmentService;
  settings: SettingsStore;
  clock: Clock;
  /** Cross-tab mutual exclusion for growth (navigator.locks in browsers). */
  lock?: LockFn;
  chunkSize?: number;
  yieldFn?: () => Promise<void>;
  /** How long start-up waits for a weather capture before catching up. */
  envWaitMs?: number;
}

const ENV_REFRESH_MS = 45 * 60_000;
const ENV_RETRY_MS = 10 * 60_000;

export function browserLock(): LockFn {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return (fn) => fn();
  return (fn) => locks.request('dot-life-growth', fn) as ReturnType<typeof fn>;
}

/** Trim a name and check it; names may repeat. */
export function normalizeName(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('名前を入力してください');
  if ([...clean].length > NAME_MAX_LENGTH) throw new Error(`名前は${NAME_MAX_LENGTH}文字までです`);
  return clean;
}

export { resolveStyle, type StyleChoice } from '../core/looks';

/**
 * Orchestrates the game. Growth correctness is derived only from the stored
 * start time, the stored last processed slot and the current time — timers
 * merely call checkGrowth() and drive the display.
 */
export class GameController {
  pixels: Pixel[] = [];
  private sim: Simulation | null = null;
  private achieved = new Set<string>();
  private envLogs: EnvironmentLog[] = [];
  private state: ControllerState = {
    status: 'loading',
    error: null,
    game: null,
    pixelCount: 0,
    milestones: [],
    latestEnv: null,
    weatherLog: null,
    catchUp: null,
    clockWarning: false,
    locationStatus: null,
    completion: 'growing',
    inventory: {},
    coins: 0,
    shop: 'none',
    ads: 'none',
    adsLeftToday: 0,
    medals: 0,
    stickers: {},
    stickersSeen: [],
  };
  private adPort: AdPort | null = null;
  private store: PurchasePort | null = null;
  private stateListeners = new Set<(s: ControllerState) => void>();
  private pixelListeners = new Set<(e: PixelEvent) => void>();
  private growing: Promise<number> | null = null;
  private envCapture: Promise<EnvironmentLog | null> | null = null;
  private lastEnvAttempt = -Infinity;
  private readonly lock: LockFn;
  private readonly chunkSize: number;
  private readonly yieldFn: () => Promise<void>;

  constructor(private readonly deps: ControllerDeps) {
    this.lock = deps.lock ?? ((fn) => fn());
    this.chunkSize = deps.chunkSize ?? 120;
    this.yieldFn = deps.yieldFn ?? (() => new Promise((r) => setTimeout(r, 0)));
  }

  // ---- subscription ---------------------------------------------------------

  getState(): ControllerState {
    return this.state;
  }

  subscribe(fn: (s: ControllerState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private reactionListeners = new Set<(e: ReactionEvent) => void>();

  /** Fired when an item is used (for the creature's reaction animation). */
  onReaction(fn: (e: ReactionEvent) => void): () => void {
    this.reactionListeners.add(fn);
    return () => this.reactionListeners.delete(fn);
  }

  onPixels(fn: (e: PixelEvent) => void): () => void {
    this.pixelListeners.add(fn);
    return () => this.pixelListeners.delete(fn);
  }

  private setState(patch: Partial<ControllerState>) {
    if ('game' in patch) patch = { ...patch, completion: completionOf(patch.game ?? null) };
    this.state = { ...this.state, ...patch };
    for (const l of this.stateListeners) l(this.state);
  }

  private emitPixels(pixels: readonly Pixel[], reason: PixelReason) {
    for (const l of this.pixelListeners) l({ pixels, reason });
  }

  get simulation(): Simulation | null {
    return this.sim;
  }

  // ---- lifecycle ------------------------------------------------------------

  async init(): Promise<void> {
    try {
      this.envLogs = await this.deps.repo.recentEnvironmentLogs(72);
      this.updateWeatherState();
      this.setState({ inventory: await this.deps.repo.getInventory(), coins: await this.deps.repo.getCoins(), ...(await this.deps.repo.getMedalsAndStickers()) });
      const game = await this.deps.repo.getActiveGame();
      if (!game) {
        this.setState({ status: 'no-game' });
        return;
      }
      await this.loadGame(game);
    } catch (e) {
      this.setState({ status: 'error', error: (e as Error).message });
      return;
    }
    // Give the weather a short chance to arrive so the newest slots can use it.
    await Promise.race([
      this.refreshEnvironment(true),
      new Promise((r) => setTimeout(r, this.deps.envWaitMs ?? 4000)),
    ]);
    await this.checkGrowth();
  }

  private async loadGame(game: GameState): Promise<void> {
    const pixels = await this.deps.repo.loadPixels(game.gameId);
    for (let i = 0; i < pixels.length; i++) {
      if (pixels[i].growthIndex !== i) throw new Error(`保存データの整合性エラー: growthIndex ${i} が見つかりません`);
    }
    if (pixels.length !== game.lastProcessedGrowthIndex + 1) {
      throw new Error(`保存データの整合性エラー: ドット数 ${pixels.length} / 記録 ${game.lastProcessedGrowthIndex + 1}`);
    }
    const milestones = await this.deps.repo.loadMilestones(game.gameId);
    this.sim = new Simulation(game, pixels);
    this.pixels = pixels;
    this.achieved = new Set(milestones.map((m) => m.id));
    this.setState({ status: 'ready', error: null, game, pixelCount: pixels.length, milestones, catchUp: null });
    this.emitPixels(pixels, 'initial');
    void this.maybeClaimGift();
  }

  /** Start a new individual. 'random' picks a style from the seed. */
  async startNewGame(choice: StyleChoice = 'cute'): Promise<void> {
    const now = this.deps.clock.now();
    const initialSeed = freshSeed();
    const { style, species } = resolveStyle(choice, initialSeed);
    const game: GameState = {
      gameId: `g${now.toString(36)}${initialSeed.toString(36)}`,
      startedAt: now,
      lastProcessedGrowthIndex: 0,
      schemaVersion: SCHEMA_VERSION,
      generatorVersion: CURRENT_GENERATOR_VERSION,
      initialSeed,
      createdAt: now,
      updatedAt: now,
      lastObservedAt: now,
      slotMs: SLOT_MS,
      style,
      ...(species ? { species } : {}),
    };
    const sim = new Simulation(game);
    const slot = this.envForSlot(now);
    const pixel: Pixel = { ...sim.generateNext({ createdAt: now, env: slot.env, environmentSnapshotId: slot.id }).pixel, gem: null };
    await this.deps.repo.createGame(game, pixel, null);
    this.sim = sim;
    this.pixels = [pixel];
    this.achieved = new Set();
    this.setState({ status: 'ready', error: null, game, pixelCount: 1, milestones: [], clockWarning: false });
    this.emitPixels(this.pixels, 'initial');
    void this.refreshEnvironment(true);
  }

  // ---- growth ---------------------------------------------------------------

  /** Cheap check used by the display timer. */
  isGrowthDue(now = this.deps.clock.now()): boolean {
    const g = this.state.game;
    return !!g && this.state.status === 'ready' && dueIndexAt(g, now) > g.lastProcessedGrowthIndex;
  }

  /** Generate and persist every due slot. Safe to call concurrently. */
  checkGrowth(): Promise<number> {
    if (this.state.status !== 'ready') return Promise.resolve(0);
    if (!this.growing) {
      this.growing = this.lock(() => this.growLocked()).finally(() => {
        this.growing = null;
      });
    }
    return this.growing;
  }

  private async growLocked(): Promise<number> {
    await this.syncFromDb();
    let game = this.state.game;
    if (!game || !this.sim || this.state.status !== 'ready') return 0;
    const now = this.deps.clock.now();

    // Clock rollback: never delete or regenerate; just wait for time to pass.
    if (now < game.lastObservedAt - CLOCK_ROLLBACK_TOLERANCE_MS) {
      if (!this.state.clockWarning) {
        const m: Milestone = {
          id: `${game.gameId}:clock-rollback:${game.lastObservedAt}`,
          gameId: game.gameId,
          achievedAt: now,
          type: 'clock-rollback',
          metadata: { growthIndex: game.lastProcessedGrowthIndex, pixelCount: game.lastProcessedGrowthIndex + 1, rollbackMs: game.lastObservedAt - now },
        };
        if (!this.achieved.has(m.id)) {
          this.achieved.add(m.id);
          await this.deps.repo.putMilestone(m);
          this.setState({ milestones: sortMilestones([...this.state.milestones, m]) });
        }
        this.setState({ clockWarning: true });
      }
    } else if (this.state.clockWarning && now >= game.lastObservedAt) {
      this.setState({ clockWarning: false });
    }

    // growth never pauses: past completion the body keeps getting bigger (abilities stay as they were)
    const due = dueIndexAt(game, now);
    const last = game.lastProcessedGrowthIndex;
    if (due <= last) return 0;

    const total = due - last;
    const isCatchUp = total > 1;
    if (isCatchUp) this.setState({ catchUp: { done: 0, total } });
    const settings = this.deps.settings.get();
    const place = settings.locationEnabled ? this.deps.environment.placeCode() : null;
    let added = 0;
    try {
      while (this.sim.nextIndex <= due) {
        const from = this.sim.nextIndex;
        const to = Math.min(due, from + this.chunkSize - 1);
        const pixels: Pixel[] = [];
        const milestones: Milestone[] = [];
        for (let i = from; i <= to; i++) {
          const createdAt = Math.floor(slotDueAt(game, i));
          const slot = this.envForSlot(createdAt, settings);
          const r = this.sim.generateNext({ createdAt, env: slot.env, environmentSnapshotId: slot.id });
          // precious dot: decided now (weather, time, this launch, place) and stored with the dot
          const box = r.analysis?.face?.box;
          const inFace = !!box && r.pixel.x >= box.x0 && r.pixel.x <= box.x1 && r.pixel.y >= box.y0 && r.pixel.y <= box.y1;
          const gem = rollGem({ initialSeed: game.initialSeed, growthIndex: i, env: slot.env, processedAt: now, place, inFace });
          r.pixel.gem = gem;
          pixels.push(r.pixel);
          milestones.push(...detectMilestones(r.pixel, r.freshAnalysis ? r.analysis : null, this.achieved, dotsPerDay(game)));
        }
        game = await this.deps.repo.appendGrowth(game.gameId, from - 1, pixels, milestones, now);
        this.pixels.push(...pixels);
        added += pixels.length;
        this.setState({
          game,
          pixelCount: this.pixels.length,
          milestones: milestones.length ? sortMilestones([...this.state.milestones, ...milestones]) : this.state.milestones,
          catchUp: isCatchUp ? { done: added, total } : null,
        });
        this.emitPixels(pixels, isCatchUp ? 'catchup' : 'growth');
        if (this.sim.nextIndex <= due) await this.yieldFn();
      }
    } catch (e) {
      // In-memory state may be ahead of the DB: rebuild it from storage.
      await this.reloadFromDb();
      if (!(e instanceof GrowthConflictError)) {
        this.setState({ error: `成長の保存に失敗しました: ${(e as Error).message}` });
      }
    } finally {
      this.setState({ catchUp: null });
    }
    await this.maybeClaimGift();
    return added;
  }

  // ---- items & gifts ---------------------------------------------------------

  /**
   * Give the creature an item. It never adds a dot: it pulls the next growth
   * (and every later hourly slot) earlier by the item's minutes, but never
   * closer than a minute from now.
   */
  async useItem(itemId: string): Promise<ReactionEvent> {
    const item = ITEM_BY_ID.get(itemId);
    if (!item) throw new Error('不明なアイテムです');
    if (this.growing) await this.growing;
    const g = this.state.game;
    if (!g || this.state.status !== 'ready') throw new Error('育てている子がいません');
    if (this.state.completion === 'complete') throw new Error('この子は完成しています。新しい子を育てるか、育て続けるを選んでね');
    if (!((this.state.inventory[itemId] ?? 0) > 0)) throw new Error('そのアイテムを持っていません');
    const now = this.deps.clock.now();
    // effective time still to go before the next dot; while a pace-up runs it passes faster
    const remaining = g.startedAt + (g.lastProcessedGrowthIndex + 1) * slotMsOf(g) - effectiveTime(g, now);
    const margin = MIN_WAIT_AFTER_ITEM_MS * (activeBoost(g, now) ? BOOST_RATE : 1);
    const ms = Math.min(item.minutes * 60_000, remaining - margin);
    if (ms <= 0) throw new Error('もうすぐ大きくなるよ。少し待ってから使ってね');
    const { game, inventory } = await this.lock(() => this.deps.repo.useItem(g.gameId, itemId, Math.floor(ms), now));
    this.setState({ game, inventory });
    const ev = { item, ms: Math.floor(ms) };
    for (const l of this.reactionListeners) l(ev);
    return ev;
  }

  // ---- shop (coins) & pace-ups ---------------------------------------------------

  /** Connect the coin store (App Store / Google Play, or the trial store). */
  async attachStore(port: PurchasePort): Promise<void> {
    this.store = port;
    await port.start(async ({ transactionId, productId, quantity }) => {
      const pack = COIN_PACK_BY_ID.get(productId);
      if (!pack) throw new Error(`unknown product ${productId}`);
      const units = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
      const { coins } = await this.deps.repo.creditPurchase(transactionId, productId, pack.coins * units, this.deps.clock.now());
      this.setState({ coins });
    });
    this.setState({ shop: port.kind });
  }

  /** Connect rewarded ads (AdMob in the app, or the trial's pretend ad). */
  async attachAds(port: AdPort): Promise<void> {
    this.adPort = port;
    await port.start();
    await this.refreshAdsLeft();
    this.setState({ ads: port.kind });
  }

  /** Recount today's remaining ads (the day may have changed). */
  async refreshAdsLeft(): Promise<number> {
    const watched = await this.deps.repo.adRewardsOn(dayKey(this.deps.clock.now()));
    const left = Math.max(0, AD_DAILY_LIMIT - watched);
    this.setState({ adsLeftToday: left });
    return left;
  }

  /**
   * Watch one rewarded ad for coins. Returns the coins received, or 0 if the
   * ad was closed before the reward. Limited to AD_DAILY_LIMIT a day.
   */
  async watchAdForCoins(): Promise<number> {
    if (!this.adPort) throw new Error('広告はアプリ版で見られます');
    if ((await this.refreshAdsLeft()) <= 0) throw new Error('今日の広告はおしまい。また明日見てね');
    let rewarded: boolean;
    try {
      rewarded = await this.adPort.showRewarded();
    } catch {
      throw new Error('広告を読みこめませんでした。時間をおいて試してください');
    }
    if (!rewarded) return 0;
    // the day is the one when the ad finished
    const r = await this.deps.repo.creditAdReward(dayKey(this.deps.clock.now()), AD_REWARD_COINS, AD_DAILY_LIMIT);
    await this.refreshAdsLeft();
    if (!r) return 0;
    this.setState({ coins: r.coins });
    return AD_REWARD_COINS;
  }

  coinPacks() {
    return this.store?.products() ?? [];
  }

  /** Buy a coin pack. Resolves false when cancelled; coins arrive through the store handler. */
  async buyCoins(productId: string): Promise<boolean> {
    if (!this.store) throw new Error('コインはアプリ版で購入できます');
    return this.store.buy(productId);
  }

  /** Exchange coins for one pace-up item. */
  async exchangeBoost(boostId: string): Promise<BoostDef> {
    const b = BOOST_BY_ID.get(boostId);
    if (!b) throw new Error('不明なアイテムです');
    if (this.state.coins < b.cost) throw new Error('コインが足りません');
    const { coins, inventory } = await this.deps.repo.exchangeCoins(b.id, b.cost);
    this.setState({ coins, inventory });
    return b;
  }

  /**
   * Use a pace-up item: no dot is added now; growth runs BOOST_RATE times
   * faster until the item's days are saved. Before completion it saves at
   * most what is left until the 721st dot.
   */
  async useBoost(boostId: string): Promise<{ boost: BoostDef; ms: number }> {
    const b = BOOST_BY_ID.get(boostId);
    if (!b) throw new Error('不明なアイテムです');
    if (this.growing) await this.growing;
    const g = this.state.game;
    if (!g || this.state.status !== 'ready') throw new Error('育てている子がいません');
    if (this.state.completion === 'complete') throw new Error('この子は完成しています。新しい子を育てるか、育て続けるを選んでね');
    if (!((this.state.inventory[boostId] ?? 0) > 0)) throw new Error('そのアイテムを持っていません');
    const now = this.deps.clock.now();
    let ms = boostMs(b);
    if (!g.keepGrowing) {
      // what is still left to the 721st dot after everything already queued
      const left = g.startedAt + COMPLETE_GROWTH_INDEX * slotMsOf(g) - effectiveTime(g, now) - pendingBoostMs(g, now);
      ms = Math.min(ms, Math.floor(left));
      if (ms < HOUR_MS) throw new Error('もうすぐ完成するので、これ以上は短くできません');
    }
    const { game, inventory } = await this.lock(() => this.deps.repo.useBoost(g.gameId, b.id, ms, now));
    this.setState({ game, inventory });
    return { boost: b, ms };
  }

  // ---- practice ranked battles -------------------------------------------------

  /**
   * The ranked record rolled into this season / day. When a season has just
   * ended, its reward (coins by the best rank reached) is paid once here.
   */
  async rankedStatus(): Promise<{ rec: RankedRecord; champion: GameState | null; seasonReward: { season: string; tier: RankTier } | null }> {
    const now = this.deps.clock.now();
    let reward: { season: string; tier: RankTier } | null = null;
    const { rec, wallet } = await this.deps.repo.updateRanked((cur) => {
      const r = rollRecord(cur ?? freshRecord(seasonOf(now), dayKey(now)), seasonOf(now), dayKey(now));
      reward = r.reward;
      return { rec: r.rec, coins: r.reward?.tier.seasonCoins };
    });
    if (reward) this.setState({ coins: wallet });
    const champId = await this.deps.repo.getChampion();
    const champion = champId ? (await this.deps.repo.listArchivedGames()).find((g) => g.gameId === champId) ?? null : null;
    return { rec, champion, seasonReward: reward };
  }

  /** Make a finished creature from the collection the ranked representative. */
  setChampion(gameId: string): Promise<void> {
    return this.deps.repo.setChampion(gameId, COMPLETE_GROWTH_INDEX + 1);
  }

  getChampionId(): Promise<string | null> {
    return this.deps.repo.getChampion();
  }

  /**
   * Today's next rival. Fixed by season, day and battle count, so looking
   * again shows the same rival (no re-rolling for an easy one).
   */
  rivalFor(rec: RankedRecord, championId: string): Rival {
    return makeRival(hash32(`${rec.season}:${rec.day}:${rec.played}`, championId), rec.rating);
  }

  /**
   * Fight the rival. The result is decided and saved before it is shown, so
   * closing the app mid-battle does not undo it.
   */
  async playRanked(championStats: Stats, championName: string, rival: Rival, rec: RankedRecord, championId: string): Promise<{ battle: BattleResult; before: number; after: number; rec: RankedRecord; medals: number }> {
    const seed = hash32(`${rec.season}:${rec.day}:${rec.played}:battle`, championId);
    const battle = simulateBattle({ name: championName, stats: championStats }, { name: rival.name, stats: rival.stats }, seed);
    const result = battle.winner === 'a' ? 'win' : battle.winner === 'b' ? 'loss' : 'draw';
    const now = this.deps.clock.now();
    let before = 0;
    const saved = await this.deps.repo.updateRanked((cur) => {
      const { rec: r, reward } = rollRecord(cur ?? freshRecord(seasonOf(now), dayKey(now)), seasonOf(now), dayKey(now));
      if (reward) throw new Error('シーズンが切りかわりました。もう一度ひらいてください');
      // another tab (or a new day) may have moved on: only the battle that was shown counts
      if (r.season !== rec.season || r.day !== rec.day || r.played !== rec.played) throw new Error('対戦の状況が変わりました。もう一度ひらいてください');
      if (r.played >= RANKED_DAILY_LIMIT) throw new Error('今日のランク戦はおしまい。また明日ね');
      before = r.rating;
      const rating = applyResult(r.rating, result);
      const entry = { at: now, rival: rival.name, rivalRating: rival.rating, result, delta: rating - r.rating } as const;
      return {
        rec: {
          ...r,
          rating,
          best: Math.max(r.best, rating),
          wins: r.wins + (result === 'win' ? 1 : 0),
          losses: r.losses + (result === 'loss' ? 1 : 0),
          draws: r.draws + (result === 'draw' ? 1 : 0),
          played: r.played + 1,
          history: [entry, ...r.history].slice(0, 30),
        },
      };
    });
    const medals = await this.rewardMedals('ranked', result);
    return { battle, before, after: saved.rec.rating, rec: saved.rec, medals };
  }

  /** Stats of the creature being raised now (from its dots). */
  currentStats(): Stats | null {
    return this.pixels.length ? withSticker(statsOf(this.pixels), this.state.game?.sticker) : null;
  }

  /**
   * After a battle: the first win of each local day earns one ordinary item.
   * Returns the item given, or null.
   */
  async rewardBattle(won: boolean): Promise<ItemDef | null> {
    if (!won) return null;
    const now = this.deps.clock.now();
    const d = new Date(now);
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const pool = ITEMS.filter((i) => !i.rare);
    const item = pool[hash32(now, 'battle-reward') % pool.length];
    const inventory = await this.deps.repo.grantDailyBattleReward(day, item.id);
    if (!inventory) return null;
    this.setState({ inventory });
    return item;
  }

  // ---- medals, gacha & stickers --------------------------------------------------

  /** Medals for a finished battle. Returns how many were actually given. */
  async rewardMedals(kind: 'wild' | 'ranked', result: 'win' | 'loss' | 'draw'): Promise<number> {
    const n = kind === 'ranked' ? (result === 'win' ? MEDALS.rankedWin : MEDALS.rankedOther) : result === 'win' ? MEDALS.wildWin : 0;
    if (!n) return 0;
    const { medals, gained } = await this.deps.repo.addMedals(n, dayKey(this.deps.clock.now()), kind === 'wild', MEDALS.wildDailyCap);
    this.setState({ medals });
    return gained;
  }

  /** Trial / dev builds only (the time-skip panel): add medals to try the gacha. */
  async devAddMedals(n: number): Promise<void> {
    const { medals } = await this.deps.repo.addMedals(n, dayKey(this.deps.clock.now()), false, 0);
    this.setState({ medals });
  }

  /** Draw the sticker gacha `times` times (10 medals each). */
  async pullGacha(times: 1 | 10): Promise<StickerDef[]> {
    const cost = GACHA_COST * times;
    if (this.state.medals < cost) throw new Error('メダルが足りません');
    const r = new Rng(freshSeed());
    const got = Array.from({ length: times }, () => drawSticker(r));
    const { medals, stickers, stickersSeen } = await this.deps.repo.pullGacha(cost, got.map((s) => s.id));
    this.setState({ medals, stickers, stickersSeen });
    return got;
  }

  /** Put a sticker on a creature (the one being raised or one in the collection); null takes it off. */
  async putSticker(gameId: string, stickerId: string | null): Promise<GameState> {
    const { game, stickers } = await this.lock(() => this.deps.repo.setSticker(gameId, stickerId));
    this.setState(this.state.game?.gameId === gameId ? { game, stickers } : { stickers });
    for (const l of this.stickerListeners) l(game);
    return game;
  }

  private stickerListeners = new Set<(g: GameState) => void>();
  /** Fired when a creature's sticker changes (for the renderer). */
  onSticker(fn: (g: GameState) => void): () => void {
    this.stickerListeners.add(fn);
    return () => this.stickerListeners.delete(fn);
  }

  /** Receive the thank-you present once the creature is complete. */
  private async maybeClaimGift(): Promise<void> {
    const g = this.state.game;
    if (!g || g.giftClaimedAt !== undefined || completionOf(g) === 'growing') return;
    const { game, inventory } = await this.deps.repo.claimGift(g.gameId, giftFor(g.initialSeed), this.deps.clock.now());
    if (this.state.game?.gameId === game.gameId) this.setState({ game, inventory });
  }

  /** Pick up growth written by another tab, or a reset/import elsewhere. */
  private async syncFromDb(): Promise<void> {
    const mem = this.state.game;
    if (!mem) return;
    const stored = await this.deps.repo.getGame(mem.gameId);
    if (!stored) {
      await this.reloadFromDb();
      return;
    }
    if (stored.lastProcessedGrowthIndex !== mem.lastProcessedGrowthIndex) await this.reloadFromDb();
  }

  private async reloadFromDb(): Promise<void> {
    const game = await this.deps.repo.getActiveGame();
    if (!game) {
      this.sim = null;
      this.pixels = [];
      this.setState({ status: 'no-game', game: null, pixelCount: 0, milestones: [] });
      return;
    }
    await this.loadGame(game);
  }

  // ---- environment ----------------------------------------------------------

  /** Environment inputs for a slot, using a weather capture close to that time. */
  envForSlot(createdAt: number, settings = this.deps.settings.get()): { env: EnvUsed; id: string | null } {
    const hour = new Date(createdAt).getHours();
    let best: EnvironmentLog | null = null;
    for (const log of this.envLogs) {
      if (log.fetchStatus !== 'ok') continue;
      const d = Math.abs(log.capturedAt - createdAt);
      if (d <= WEATHER_VALID_MS && (!best || d < Math.abs(best.capturedAt - createdAt))) best = log;
    }
    return {
      env: {
        timeOfDay: timeOfDayFromHour(hour),
        localHour: hour,
        weather: best?.weather ?? 'unknown',
        environmentInfluence: settings.environmentInfluence,
        organicShapeBias: settings.organicShapeBias,
      },
      id: best?.id ?? null,
    };
  }

  private updateWeatherState() {
    const now = this.deps.clock.now();
    const latest = this.envLogs[this.envLogs.length - 1] ?? null;
    let weatherLog: EnvironmentLog | null = null;
    for (let i = this.envLogs.length - 1; i >= 0; i--) {
      const l = this.envLogs[i];
      if (l.fetchStatus === 'ok' && Math.abs(now - l.capturedAt) <= WEATHER_VALID_MS) { weatherLog = l; break; }
    }
    this.setState({ latestEnv: latest, weatherLog });
  }

  /** Called by the display timer; refreshes weather at a modest cadence. */
  maybeRefreshEnvironment(): void {
    const now = this.deps.clock.now();
    const ok = this.state.weatherLog;
    const stale = !ok || now - ok.capturedAt > ENV_REFRESH_MS;
    if (stale && now - this.lastEnvAttempt > ENV_RETRY_MS) void this.refreshEnvironment(false);
  }

  async refreshEnvironment(force: boolean): Promise<EnvironmentLog | null> {
    if (this.envCapture) return this.envCapture;
    const now = this.deps.clock.now();
    if (!force && now - this.lastEnvAttempt < ENV_RETRY_MS) return null;
    this.lastEnvAttempt = now;
    this.envCapture = (async () => {
      try {
        const settings = this.deps.settings.get();
        const log = await this.deps.environment.capture(now, this.state.game?.gameId ?? null, settings.locationEnabled);
        if (log.fetchStatus === 'denied' && settings.locationEnabled) {
          this.deps.settings.update({ locationEnabled: false });
          this.deps.environment.clearLocation();
        }
        this.envLogs.push(log);
        if (this.envLogs.length > 200) this.envLogs.splice(0, this.envLogs.length - 200);
        this.setState({ locationStatus: log.fetchStatus });
        this.updateWeatherState();
        // Logs are only persisted when they carry information worth keeping.
        if (log.fetchStatus !== 'disabled') {
          await this.deps.repo.putEnvironmentLog(log).catch(() => undefined);
        }
        return log;
      } catch {
        return null; // environment must never break the game
      } finally {
        this.envCapture = null;
      }
    })();
    return this.envCapture;
  }

  async setLocationEnabled(enabled: boolean): Promise<FetchStatus | null> {
    this.deps.settings.update({ locationEnabled: enabled });
    if (!enabled) {
      this.deps.environment.clearLocation();
      this.setState({ locationStatus: 'disabled' });
      return 'disabled';
    }
    const log = await this.refreshEnvironment(true);
    return log?.fetchStatus ?? null;
  }

  // ---- save data ------------------------------------------------------------

  async exportSaveText(): Promise<string> {
    const g = this.state.game;
    if (!g) throw new Error('ゲームがありません');
    if (this.growing) await this.growing;
    const save = await this.deps.repo.exportSave(g.gameId, this.deps.clock.now());
    return JSON.stringify(save);
  }

  async importSaveText(text: string): Promise<void> {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('JSONとして読み込めません');
    }
    if (this.growing) await this.growing;
    await this.lock(() => this.deps.repo.importSave(json)); // validates before writing
    this.envLogs = await this.deps.repo.recentEnvironmentLogs(72);
    this.updateWeatherState();
    await this.reloadFromDb();
    await this.checkGrowth();
  }

  // ---- completion & collection ----------------------------------------------

  /** Keep growing past completion; missed time is caught up immediately. */
  async continueGrowing(): Promise<void> {
    const g = this.state.game;
    if (!g) return;
    const updated = await this.deps.repo.updateGameFlags(g.gameId, { keepGrowing: true });
    if (updated) this.setState({ game: updated });
    await this.checkGrowth();
  }

  /**
   * Move the current creature to the collection under `name` (kept, no longer
   * growing) and return to the start screen. Names may repeat.
   */
  async retireToCollection(name: string): Promise<void> {
    const clean = normalizeName(name);
    if (this.growing) await this.growing;
    await this.lock(() => this.deps.repo.archiveActiveGame(this.deps.clock.now(), clean));
    this.sim = null;
    this.pixels = [];
    this.achieved = new Set();
    this.setState({ status: 'no-game', game: null, pixelCount: 0, milestones: [], catchUp: null, clockWarning: false, error: null });
  }

  listCollection(): Promise<GameState[]> {
    return this.deps.repo.listArchivedGames();
  }

  loadCollectionPixels(gameId: string): Promise<Pixel[]> {
    return this.deps.repo.loadPixels(gameId);
  }

  async renameInCollection(gameId: string, name: string): Promise<GameState> {
    return this.deps.repo.renameArchivedGame(gameId, normalizeName(name));
  }

  /** Default name suggestion for the next collection entry. */
  async suggestName(): Promise<string> {
    const n = (await this.deps.repo.listArchivedGames()).length + 1;
    return `ドット${n}号`;
  }

  deleteFromCollection(gameId: string): Promise<void> {
    return this.deps.repo.deleteArchivedGame(gameId);
  }

  async resetGame(): Promise<void> {
    if (this.growing) await this.growing;
    await this.lock(() => this.deps.repo.resetActiveGame());
    this.sim = null;
    this.pixels = [];
    this.achieved = new Set();
    this.setState({ status: 'no-game', game: null, pixelCount: 0, milestones: [], catchUp: null, clockWarning: false, error: null });
  }
}
