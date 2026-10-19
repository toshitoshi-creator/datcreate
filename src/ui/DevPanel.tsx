import { useState } from 'react';
import { DAY_MS, HOUR_MS } from '../core/constants';
import type { DevClock } from '../engine/clock';

const STEPS: { label: string; ms: number }[] = [
  { label: '+1時間', ms: HOUR_MS },
  { label: '+1日', ms: DAY_MS },
  { label: '+1週間', ms: 7 * DAY_MS },
  { label: '+15日', ms: 15 * DAY_MS },
  { label: '+1年', ms: 365 * DAY_MS },
];

/** Time-skip for dev builds and the trial bundle. Never rendered in the normal production build. */
export function DevPanel({ devClock, onAdvanced }: { devClock: DevClock; onAdvanced: () => void }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(devClock.offsetMs);
  const adv = (ms: number) => {
    devClock.advance(ms);
    setOffset(devClock.offsetMs);
    onAdvanced();
  };
  const days = Math.floor(offset / DAY_MS);
  const hours = Math.floor((offset % DAY_MS) / HOUR_MS);
  return (
    <div className="dev-panel">
      <button className="dev-toggle" data-testid="time-skip" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⏩ 時間送り
      </button>
      {open && (
        <div className="dev-body">
          <div className="muted small">体験用: 進めた時間 {days}日{hours}時間</div>
          <div className="dev-steps">
            {STEPS.map((s) => (
              <button key={s.label} onClick={() => adv(s.ms)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
