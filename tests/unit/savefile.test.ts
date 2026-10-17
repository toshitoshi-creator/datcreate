import { describe, expect, it } from 'vitest';
import { SAVE_FORMAT } from '../../src/core/constants';
import { migrateSave, parseSaveText, validateSave } from '../../src/data/saveFile';
import { DEFAULT_SETTINGS, SettingsStore, sanitizeSettings } from '../../src/data/settings';
import { MemoryStorage, grow } from '../helpers';

function makeSave(n = 20) {
  const { pixels } = grow(3, n);
  const gameId = 'test';
  return {
    format: SAVE_FORMAT,
    schemaVersion: 1,
    exportedAt: 1,
    game: { gameId, startedAt: pixels[0].createdAt, lastProcessedGrowthIndex: n - 1, schemaVersion: 1, generatorVersion: 1, initialSeed: 3, createdAt: 1, updatedAt: 1, lastObservedAt: 1 },
    pixels,
    environmentLogs: [],
    milestones: [],
  };
}

describe('save file validation', () => {
  it('accepts a valid save', () => {
    const r = validateSave(makeSave());
    expect(r.ok).toBe(true);
  });

  it('rejects wrong format, future versions, unknown generators and gaps', () => {
    expect(validateSave({ ...makeSave(), format: 'x' }).ok).toBe(false);
    expect(validateSave({ ...makeSave(), schemaVersion: 2 }).ok).toBe(false);
    const g = makeSave();
    g.game.generatorVersion = 99;
    expect(validateSave(g).ok).toBe(false);
    const gap = makeSave();
    gap.pixels.splice(3, 1);
    gap.game.lastProcessedGrowthIndex = gap.pixels.length - 1;
    expect(validateSave(gap).ok).toBe(false);
    expect(parseSaveText('nope').ok).toBe(false);
  });

  it('runs registered migrations step by step', () => {
    const migrations = {
      1: (s: Record<string, unknown>) => ({ ...s, note: 'v1->v2' }),
      2: (s: Record<string, unknown>) => ({ ...s, note2: 'v2->v3' }),
    };
    const out = migrateSave({ ...makeSave(), schemaVersion: 1 }, migrations, 3);
    expect(out).toMatchObject({ schemaVersion: 3, note: 'v1->v2', note2: 'v2->v3' });
    expect((out.game as { schemaVersion: number }).schemaVersion).toBe(3);
    expect(() => migrateSave({ ...makeSave(), schemaVersion: 1 }, {}, 2)).toThrow();
  });
});

describe('settings', () => {
  it('sanitizes and clamps', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ environmentInfluence: 9, organicShapeBias: -1, soundEnabled: 'yes', zoomLevel: 3 });
    expect(s.environmentInfluence).toBe(1);
    expect(s.organicShapeBias).toBe(0);
    expect(s.soundEnabled).toBe(false);
    expect(s.zoomLevel).toBe(3);
  });
  it('persists to storage and survives corrupt data', () => {
    const storage = new MemoryStorage();
    new SettingsStore(storage).update({ animationEnabled: false });
    expect(new SettingsStore(storage).get().animationEnabled).toBe(false);
    storage.setItem('dotlife.settings.v1', '{broken');
    expect(new SettingsStore(storage).get()).toEqual(DEFAULT_SETTINGS);
  });
});
