export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

const DEV_OFFSET_KEY = 'dotlife.dev.clockOffset';

/**
 * Clock with a manual offset, used by the time-skip panel. It is only
 * constructed in dev builds and in the separately built trial bundle
 * (VITE_DEMO_TIME=1); the normal production build never exposes a way to
 * fast-forward time. The offset persists so a reload does not look like the
 * clock going backwards.
 */
export class DevClock implements Clock {
  private offset: number;

  constructor() {
    this.offset = Number(safeGet(DEV_OFFSET_KEY) ?? 0) || 0;
  }

  now(): number {
    return Date.now() + this.offset;
  }

  advance(ms: number) {
    this.offset += ms;
    safeSet(DEV_OFFSET_KEY, String(this.offset));
  }

  reset() {
    this.offset = 0;
    safeSet(DEV_OFFSET_KEY, null);
  }

  get offsetMs() {
    return this.offset;
  }
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function safeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: offset stays in memory */
  }
}
