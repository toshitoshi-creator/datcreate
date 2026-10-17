import { CLOCK_ROLLBACK_TOLERANCE_MS, CURRENT_GENERATOR_VERSION, SCHEMA_VERSION, WEATHER_VALID_MS } from '../core/constants';
import { Simulation } from '../core/generator';
import { detectMilestones, sortMilestones } from '../core/milestones';
import { freshSeed } from '../core/rng';
import { dueGrowthIndex, growthTime, timeOfDayFromHour } from '../core/time';
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

  onPixels(fn: (e: PixelEvent) => void): () => void {
    this.pixelListeners.add(fn);
    return () => this.pixelListeners.delete(fn);
  }

  private setState(patch: Partial<ControllerState>) {
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
  }

  async startNewGame(): Promise<void> {
    const now = this.deps.clock.now();
    const initialSeed = freshSeed();
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
    return !!g && this.state.status === 'ready' && dueGrowthIndex(g.startedAt, now) > g.lastProcessedGrowthIndex;
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

    const due = dueGrowthIndex(game.startedAt, now);
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
          const createdAt = growthTime(game.startedAt, i);
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
    return added;
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

  async resetGame(): Promise<void> {
    if (this.growing) await this.growing;
    await this.lock(() => this.deps.repo.resetActiveGame());
    this.sim = null;
    this.pixels = [];
    this.achieved = new Set();
    this.setState({ status: 'no-game', game: null, pixelCount: 0, milestones: [], catchUp: null, clockWarning: false, error: null });
  }
}
