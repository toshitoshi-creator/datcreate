import { afterEach, describe, expect, it, vi } from 'vitest';

const calls: unknown[][] = [];
let display = 'prompt';
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: async () => ({ display }),
    requestPermissions: async () => {
      calls.push(['request']);
      return { display: 'granted' };
    },
    cancel: async (o: unknown) => void calls.push(['cancel', o]),
    schedule: async (o: unknown) => void calls.push(['schedule', o]),
  },
}));

import { isNativeApp, nativeNotificationPort } from '../../src/services/nativeNotifications';

const g = globalThis as { Capacitor?: unknown };
afterEach(() => {
  delete g.Capacitor;
  calls.length = 0;
});

describe('native notification port', () => {
  it('is absent on the web', () => {
    expect(isNativeApp()).toBe(false);
    expect(nativeNotificationPort()).toBeNull();
  });

  it('in the app: asks permission once, replaces the single pending notice, and cancels it', async () => {
    g.Capacitor = { isNativePlatform: () => true };
    const port = nativeNotificationPort()!;
    await port.schedule(1_900_000_000_000, 'DOT LIFE', 'done');
    expect(calls[0]).toEqual(['request']);
    expect(calls[1]).toEqual(['cancel', { notifications: [{ id: 7201 }] }]);
    const sch = calls[2] as [string, { notifications: { id: number; schedule: { at: Date } }[] }];
    expect(sch[0]).toBe('schedule');
    expect(sch[1].notifications[0].id).toBe(7201);
    expect(sch[1].notifications[0].schedule.at.getTime()).toBe(1_900_000_000_000);
    await port.cancel();
    expect(calls.at(-1)).toEqual(['cancel', { notifications: [{ id: 7201 }] }]);
  });

  it('does nothing when the player declined notifications', async () => {
    g.Capacitor = { isNativePlatform: () => true };
    display = 'denied';
    await nativeNotificationPort()!.schedule(1, 't', 'b');
    expect(calls.some((c) => c[0] === 'schedule')).toBe(false);
    display = 'prompt';
  });
});
