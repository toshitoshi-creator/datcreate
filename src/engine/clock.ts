export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

const DEV_OFFSET_KEY = 'dotlife.dev.clockOffset';

/**
 * Development-only clock with a manual offset, used by the dev panel. It is
 * only constructed when import.meta.env.DEV is true, so production builds
 * never expose a way to fast-forward time.
 */
export class DevClock implements Clock {
  private offset: number;

  constructor() {
    this.offset = Number(sessionStorage.getItem(DEV_OFFSET_KEY) ?? 0) || 0;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  advance(ms: number) {
    this.offset += ms;
    sessionStorage.setItem(DEV_OFFSET_KEY, String(this.offset));
  }

  reset() {
    this.offset = 0;
    sessionStorage.removeItem(DEV_OFFSET_KEY);
  }

  get offsetMs() {
    return this.offset;
  }
}
