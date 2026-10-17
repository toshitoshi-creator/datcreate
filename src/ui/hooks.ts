import { useEffect, useState } from 'react';
import type { Settings } from '../core/types';
import type { SettingsStore } from '../data/settings';
import type { ControllerState, GameController } from '../engine/gameController';

export function useControllerState(c: GameController): ControllerState {
  const [s, set] = useState(c.getState());
  useEffect(() => {
    set(c.getState());
    return c.subscribe(set);
  }, [c]);
  return s;
}

export function useSettings(store: SettingsStore): Settings {
  const [s, set] = useState(store.get());
  useEffect(() => store.subscribe(set), [store]);
  return s;
}

/** Re-render every `ms` with the given clock's time (display only). */
export function useNow(now: () => number, ms = 1000): number {
  const [t, set] = useState(now());
  useEffect(() => {
    const id = setInterval(() => set(now()), ms);
    return () => clearInterval(id);
  }, [now, ms]);
  return t;
}
