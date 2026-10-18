import { describe, expect, it } from 'vitest';
import { COMPLETE_GROWTH_INDEX, DAY_MS } from '../../src/core/constants';
import { completionNoticeAt } from '../../src/core/notice';
import { CompletionNotifier, type NotificationPort } from '../../src/engine/completionNotifier';
import { FakeClock, HOUR_MS, T0, makeHarness } from '../helpers';

class FakePort implements NotificationPort {
  pending: number | null = null;
  calls: string[] = [];
  async schedule(at: number) {
    this.pending = at;
    this.calls.push(`schedule:${at}`);
  }
  async cancel() {
    this.pending = null;
    this.calls.push('cancel');
  }
}

async function setup() {
  const clock = new FakeClock(T0);
  const h = await makeHarness({ clock });
  const port = new FakePort();
  const n = new CompletionNotifier(h.controller, h.settings, clock, port, () => clock.now());
  const flush = () => n.sync();
  return { h, clock, port, n, flush };
}

describe('completion notice', () => {
  it('is due at the 721st dot, and none once finished, kept growing or archived', () => {
    const g = { gameId: 'g', startedAt: T0, lastProcessedGrowthIndex: 0, schemaVersion: 1, generatorVersion: 3, initialSeed: 1, createdAt: T0, updatedAt: T0, lastObservedAt: T0 };
    expect(completionNoticeAt(g)).toBe(T0 + COMPLETE_GROWTH_INDEX * HOUR_MS);
    expect(completionNoticeAt({ ...g, timeBonusMs: 3 * HOUR_MS })).toBe(T0 + (COMPLETE_GROWTH_INDEX - 3) * HOUR_MS);
    expect(completionNoticeAt({ ...g, lastProcessedGrowthIndex: COMPLETE_GROWTH_INDEX })).toBeNull();
    expect(completionNoticeAt({ ...g, keepGrowing: true })).toBeNull();
    expect(completionNoticeAt({ ...g, archivedAt: T0 })).toBeNull();
    expect(completionNoticeAt(null)).toBeNull();
  });

  it('schedules on start, moves earlier when an item is used, and is cancelled on completion', async () => {
    const { h, clock, port, flush } = await setup();
    await h.controller.startNewGame();
    await flush();
    expect(port.pending).toBe(T0 + 30 * DAY_MS);
    await h.controller.useItem('apple');
    await flush();
    expect(port.pending).not.toBeNull();
    expect(port.pending!).toBeLessThan(T0 + 30 * DAY_MS);
    // ordinary growth does not reschedule
    const before = port.calls.length;
    clock.advance(5 * HOUR_MS);
    await h.controller.checkGrowth();
    await flush();
    expect(port.calls.length).toBe(before);
    // finished: the notice is no longer pending in the app (the OS already showed it)
    clock.advance(30 * DAY_MS);
    await h.controller.checkGrowth();
    await flush();
    expect(h.controller.getState().completion).toBe('complete');
    expect(port.pending).toBeNull();
  });

  it('turning the setting off cancels it, and turning it on schedules again', async () => {
    const { h, port, flush } = await setup();
    await h.controller.startNewGame();
    await flush();
    expect(port.pending).toBe(T0 + 30 * DAY_MS);
    h.settings.update({ notifyOnComplete: false });
    await flush();
    expect(port.pending).toBeNull();
    h.settings.update({ notifyOnComplete: true });
    await flush();
    expect(port.pending).toBe(T0 + 30 * DAY_MS);
  });

  it('archiving the finished creature and resetting leave nothing pending', async () => {
    const { h, clock, port, flush } = await setup();
    await h.controller.startNewGame();
    clock.advance(30 * DAY_MS);
    await h.controller.checkGrowth();
    await h.controller.retireToCollection('ぷに');
    await flush();
    expect(port.pending).toBeNull();
    await h.controller.startNewGame();
    await flush();
    expect(port.pending).toBe(clock.now() + 30 * DAY_MS);
    await h.controller.resetGame();
    await flush();
    expect(port.pending).toBeNull();
  });

  it('a failing device API never breaks the game', async () => {
    const clock = new FakeClock(T0);
    const h = await makeHarness({ clock });
    const n = new CompletionNotifier(h.controller, h.settings, clock, { schedule: () => Promise.reject(new Error('denied')), cancel: () => Promise.reject(new Error('x')) }, () => clock.now());
    await h.controller.startNewGame();
    await expect(n.sync()).resolves.toBeUndefined();
    expect(h.controller.getState().pixelCount).toBe(1);
  });
});
