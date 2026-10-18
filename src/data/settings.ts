import type { Settings } from '../core/types';

export const SETTINGS_KEY = 'dotlife.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: false,
  animationEnabled: true,
  outlineEnabled: true,
  locationEnabled: false,
  notifyOnComplete: true,
  zoomLevel: null,
  viewCenterX: null,
  viewCenterY: null,
  environmentInfluence: 0.6,
  organicShapeBias: 0.6,
};

const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

export function sanitizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    soundEnabled: bool(r.soundEnabled, d.soundEnabled),
    animationEnabled: bool(r.animationEnabled, d.animationEnabled),
    outlineEnabled: bool(r.outlineEnabled, d.outlineEnabled),
    locationEnabled: bool(r.locationEnabled, d.locationEnabled),
    notifyOnComplete: bool(r.notifyOnComplete, d.notifyOnComplete),
    zoomLevel: numOrNull(r.zoomLevel),
    viewCenterX: numOrNull(r.viewCenterX),
    viewCenterY: numOrNull(r.viewCenterY),
    environmentInfluence: clamp01(r.environmentInfluence, d.environmentInfluence),
    organicShapeBias: clamp01(r.organicShapeBias, d.organicShapeBias),
  };
}

type Listener = (s: Settings) => void;

/** Lightweight settings persisted in localStorage (falls back to memory). */
export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor(private readonly storage: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    let raw: unknown = null;
    try {
      const text = this.storage?.getItem(SETTINGS_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    this.value = sanitizeSettings(raw);
  }

  get(): Settings {
    return this.value;
  }

  update(patch: Partial<Settings>): Settings {
    this.value = sanitizeSettings({ ...this.value, ...patch });
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(this.value));
    } catch {
      /* storage full / private mode: keep in memory */
    }
    for (const l of this.listeners) l(this.value);
    return this.value;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
