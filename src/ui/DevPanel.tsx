import { useState } from 'react';
import { DAY_MS, HOUR_MS } from '../core/constants';
import type { DevClock } from '../engine/clock';

/** Development-only time travel. Never rendered in production builds. */
export function DevPanel({ devClock, onAdvanced }: { devClock: DevClock; onAdvanced: () => void }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(devClock.offsetMs);
  const adv = (ms: number) => {
    devClock.advance(ms);
    setOffset(devClock.offsetMs);
    onAdvanced();
  };
  return (
    <div className="dev-panel">
      <button className="dev-toggle" onClick={() => setOpen(!open)}>DEV</button>
      {open && (
        <div className="dev-body">
          <div>offset: {(offset / HOUR_MS).toFixed(1)}h</div>
          <button onClick={() => adv(HOUR_MS)}>+1h</button>
          <button onClick={() => adv(DAY_MS)}>+1d</button>
          <button onClick={() => adv(7 * DAY_MS)}>+7d</button>
          <button onClick={() => adv(30 * DAY_MS)}>+30d</button>
          <button onClick={() => adv(365 * DAY_MS)}>+1y</button>
        </div>
      )}
    </div>
  );
}
