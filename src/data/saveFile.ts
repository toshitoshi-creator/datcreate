import { HEX_COLOR_RE } from '../core/color';
import { SAVE_FORMAT, SCHEMA_VERSION } from '../core/constants';
import { isSupportedGenerator } from '../core/generator';
import { CREATURE_STYLES, type CreatureStyle } from '../core/genome';
import type { EnvironmentLog, GameState, Milestone, Pixel } from '../core/types';

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  schemaVersion: number;
  exportedAt: number;
  game: GameState;
  pixels: Pixel[];
  environmentLogs: EnvironmentLog[];
  milestones: Milestone[];
}

type AnyRecord = Record<string, unknown>;

/**
 * Data migrations keyed by the version they upgrade *from*. Each step must
 * be pure and must keep every pixel's position and colour unchanged.
 * (Schema v1 is the first released format, so the table is empty for now.)
 */
export const MIGRATIONS: Record<number, (save: AnyRecord) => AnyRecord> = {};

export function migrateSave(raw: AnyRecord, migrations = MIGRATIONS, target = SCHEMA_VERSION): AnyRecord {
  let save = raw;
  let v = Number(save.schemaVersion);
  while (v < target) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from schema v${v}`);
    save = step(save);
    v += 1;
    save = { ...save, schemaVersion: v, game: { ...(save.game as AnyRecord), schemaVersion: v } };
  }
  return save;
}

const TIME_OF_DAY = new Set(['morning', 'day', 'evening', 'night']);
const WEATHER = new Set(['clear', 'cloudy', 'rain', 'snow', 'storm', 'fog', 'unknown']);
const isObj = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export type ValidationResult = { ok: true; save: SaveFile } | { ok: false; errors: string[] };

/** Strict structural validation; nothing is written unless this passes. */
export function validateSave(input: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (msg: string): ValidationResult => ({ ok: false, errors: [...errors, msg] });
  if (!isObj(input)) return fail('JSONオブジェクトではありません');
  if (input.format !== SAVE_FORMAT) return fail('dot-life のセーブデータではありません');
  if (!isInt(input.schemaVersion) || input.schemaVersion < 1) return fail('schemaVersion が不正です');
  if (input.schemaVersion > SCHEMA_VERSION) {
    return fail(`より新しいバージョン(v${input.schemaVersion})のデータです。アプリを更新してください`);
  }
  let raw: AnyRecord;
  try {
    raw = migrateSave(input);
  } catch (e) {
    return fail(`データの移行に失敗しました: ${(e as Error).message}`);
  }

  const g = raw.game;
  if (!isObj(g)) return fail('game がありません');
  for (const k of ['startedAt', 'createdAt', 'updatedAt'] as const) if (!isNum(g[k])) errors.push(`game.${k} が不正です`);
  if (!isStr(g.gameId)) errors.push('game.gameId が不正です');
  if (!isInt(g.lastProcessedGrowthIndex) || (g.lastProcessedGrowthIndex as number) < 0) errors.push('game.lastProcessedGrowthIndex が不正です');
  if (!isInt(g.initialSeed) || (g.initialSeed as number) < 0 || (g.initialSeed as number) > 0xffffffff) errors.push('game.initialSeed が不正です');
  if (!isInt(g.generatorVersion) || !isSupportedGenerator(g.generatorVersion as number)) errors.push('未対応の generatorVersion です');
  if (g.style !== undefined && !CREATURE_STYLES.includes(g.style as CreatureStyle)) errors.push('game.style が不正です');
  if (g.name !== undefined && (typeof g.name !== 'string' || g.name.length > 100)) errors.push('game.name が不正です');
  if (errors.length) return { ok: false, errors };

  const pixels = raw.pixels;
  if (!Array.isArray(pixels)) return fail('pixels がありません');
  const last = g.lastProcessedGrowthIndex as number;
  if (pixels.length !== last + 1) return fail(`ドット数(${pixels.length})が成長記録(${last + 1})と一致しません`);
  const cells = new Set<string>();
  const sorted = [...pixels].sort((a, b) => (isObj(a) && isObj(b) ? Number(a.growthIndex) - Number(b.growthIndex) : 0));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (!isObj(p)) return fail(`pixels[${i}] が不正です`);
    if (p.growthIndex !== i) return fail(`growthIndex ${i} が欠落または重複しています`);
    if (p.gameId !== g.gameId || p.id !== `${g.gameId}:${i}`) return fail(`pixels[${i}] の id/gameId が不正です`);
    if (!isInt(p.x) || !isInt(p.y)) return fail(`pixels[${i}] の座標が不正です`);
    if (typeof p.color !== 'string' || !HEX_COLOR_RE.test(p.color)) return fail(`pixels[${i}] の色が不正です`);
    if (!isNum(p.createdAt) || !isInt(p.seed) || !isInt(p.generatorVersion)) return fail(`pixels[${i}] の必須項目が不正です`);
    if (!(p.parentId === null || typeof p.parentId === 'string')) return fail(`pixels[${i}] の parentId が不正です`);
    if (!(p.environmentSnapshotId === null || typeof p.environmentSnapshotId === 'string')) return fail(`pixels[${i}] の environmentSnapshotId が不正です`);
    const e = p.envUsed;
    if (!isObj(e) || !TIME_OF_DAY.has(e.timeOfDay as string) || !WEATHER.has(e.weather as string) || !isNum(e.localHour) || !isNum(e.environmentInfluence) || !isNum(e.organicShapeBias)) {
      return fail(`pixels[${i}] の環境情報が不正です`);
    }
    const key = `${p.x},${p.y}`;
    if (cells.has(key)) return fail(`座標 ${key} にドットが重複しています`);
    cells.add(key);
  }

  const envs = raw.environmentLogs ?? [];
  if (!Array.isArray(envs) || envs.some((e) => !isObj(e) || !isStr(e.id) || !isNum(e.capturedAt) || !WEATHER.has(e.weather as string))) {
    return fail('environmentLogs が不正です');
  }
  const ms = raw.milestones ?? [];
  if (!Array.isArray(ms) || ms.some((m) => !isObj(m) || !isStr(m.id) || !isStr(m.type) || !isNum(m.achievedAt) || m.gameId !== g.gameId || !isObj(m.metadata))) {
    return fail('milestones が不正です');
  }

  const game: GameState = {
    gameId: g.gameId as string,
    startedAt: g.startedAt as number,
    lastProcessedGrowthIndex: last,
    schemaVersion: SCHEMA_VERSION,
    generatorVersion: g.generatorVersion as number,
    initialSeed: g.initialSeed as number,
    createdAt: g.createdAt as number,
    updatedAt: g.updatedAt as number,
    lastObservedAt: isNum(g.lastObservedAt) ? (g.lastObservedAt as number) : (g.updatedAt as number),
    ...(g.style !== undefined ? { style: g.style as CreatureStyle } : {}),
    ...(g.keepGrowing === true ? { keepGrowing: true } : {}),
    ...(typeof g.name === 'string' ? { name: g.name } : {}),
  };
  return {
    ok: true,
    save: {
      format: SAVE_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: isNum(raw.exportedAt) ? raw.exportedAt : 0,
      game,
      pixels: sorted as unknown as Pixel[],
      environmentLogs: envs.map((e) => ({ ...(e as unknown as EnvironmentLog), location: null, gameId: game.gameId })),
      milestones: ms as unknown as Milestone[],
    },
  };
}

export function parseSaveText(text: string): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSONとして読み込めません'] };
  }
  return validateSave(json);
}
