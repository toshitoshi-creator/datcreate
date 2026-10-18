import { CLOCK_ROLLBACK_TOLERANCE_MS, COMPLETE_GROWTH_INDEX, CURRENT_GENERATOR_VERSION, NAME_MAX_LENGTH, SCHEMA_VERSION, WEATHER_VALID_MS } from '../core/constants';
import { Simulation } from '../core/generator';
import { detectMilestones, sortMilestones } from '../core/milestones';
import type { CreatureStyle } from '../core/genome';
import { COOL_SPECIES, CUTE_SPECIES, type Species } from '../core/species';
import { freshSeed, hash32 } from '../core/rng';
import { dueGrowthIndex, growthTime, nextGrowthAt, scheduleStart, timeOfDayFromHour } from '../core/time';
import { ITEM_BY_ID, MIN_WAIT_AFTER_ITEM_MS, giftFor, type ItemDef, type Inventory } from '../core/items';
import type { EnvUsed, EnvironmentLog, FetchStatus, GameState, Milestone, Pixel } from '../core/types';
import { GrowthConflictError, type GameRepository } from '../data/repository';
import type { SettingsStore } from '../data/settings';
import type { EnvironmentService } from '../services/environmentService';
import type { Clock } from './clock';

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
   * 'complete': reached 30 days and waits for the player's choice (growth is
   * paused); 'continuing': the player chose to keep growing.
   */
  completion: Completion;
  /** Item counts (shared by all creatures). */
  inventory: Inventory;
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
function growthCap(game: GameState): number {
  return game.keepGrowing ? Infinity : COMPLETE_GROWTH_INDEX;
}

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
  };
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
      this.setState({ inventory: await this.deps.repo.getInventory() });
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
      style,
      ...(species ? { species } : {}),
    };
    const sim = new Simulation(game);
    const slot = this.envForSlot(now);
    const { pixel } = sim.generateNext({ createdAt: now, env: slot.env, environmentSnapshotId: slot.id });
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
    return !!g && this.state.status === 'ready' && Math.min(growthCap(g), dueGrowthIndex(scheduleStart(g), now)) > g.lastProcessedGrowthIndex;
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

    const due = Math.min(growthCap(game), dueGrowthIndex(scheduleStart(game), now));
    const last = game.lastProcessedGrowthIndex;
    if (due <= last) return 0;

    const total = due - last;
    const isCatchUp = total > 1;
    if (isCatchUp) this.setState({ catchUp: { done: 0, total } });
    const settings = this.deps.settings.get();
    let added = 0;
    try {
      while (this.sim.nextIndex <= due) {
        const from = this.sim.nextIndex;
        const to = Math.min(due, from + this.chunkSize - 1);
        const pixels: Pixel[] = [];
        const milestones: Milestone[] = [];
        for (let i = from; i <= to; i++) {
          const createdAt = growthTime(scheduleStart(game), i);
          const slot = this.envForSlot(createdAt, settings);
          const r = this.sim.generateNext({ createdAt, env: slot.env, environmentSnapshotId: slot.id });
          pixels.push(r.pixel);
          milestones.push(...detectMilestones(r.pixel, r.freshAnalysis ? r.analysis : null, this.achieved));
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
    const remaining = nextGrowthAt(scheduleStart(g), g.lastProcessedGrowthIndex) - now;
    const ms = Math.min(item.minutes * 60_000, remaining - MIN_WAIT_AFTER_ITEM_MS);
    if (ms <= 0) throw new Error('もうすぐ大きくなるよ。少し待ってから使ってね');
    const { game, inventory } = await this.lock(() => this.deps.repo.useItem(g.gameId, itemId, Math.floor(ms), now));
    this.setState({ game, inventory });
    const ev = { item, ms: Math.floor(ms) };
    for (const l of this.reactionListeners) l(ev);
    return ev;
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
