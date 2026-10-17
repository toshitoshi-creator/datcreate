import { useEffect, useMemo, useRef, useState } from 'react';
import { TIME_OF_DAY_LABEL, WEATHER_LABEL } from '../core/environment';
import { milestoneLabel } from '../core/milestones';
import type { Milestone, Pixel } from '../core/types';
import type { ControllerState } from '../engine/gameController';
import { drawThumbnail } from '../render/renderer';
import type { AppServices } from './services';

const PAGE = 60;

const fmt = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

interface Props {
  services: AppServices;
  state: ControllerState;
  onClose: () => void;
}

/**
 * Read-only view over stored data. Snapshots are drawn from the stored dots
 * (a prefix of the list); nothing is regenerated.
 */
export function HistoryScreen({ services, state, onClose }: Props) {
  const pixels = services.controller.pixels;
  const [tab, setTab] = useState<'shape' | 'dots'>('shape');
  const [limit, setLimit] = useState(PAGE);
  const total = state.pixelCount;
  const recent = useMemo(() => {
    const out: Pixel[] = [];
    for (let i = total - 1; i >= 0 && out.length < limit; i--) out.push(pixels[i]);
    return out;
  }, [pixels, total, limit]);
  const milestones = useMemo(() => [...state.milestones].reverse(), [state.milestones]);

  return (
    <div className="sheet" role="dialog" aria-label="成長履歴" data-testid="history-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={onClose} data-testid="close-history">← 戻る</button>
        <h2>成長履歴</h2>
        <span />
      </header>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'shape'} className={tab === 'shape' ? 'active' : ''} onClick={() => setTab('shape')}>
          形の変化
        </button>
        <button role="tab" aria-selected={tab === 'dots'} className={tab === 'dots' ? 'active' : ''} onClick={() => setTab('dots')} data-testid="tab-dots">
          ドットの記録
        </button>
      </div>
      <div className="sheet-body">
        {tab === 'shape' ? (
          <>
            <p className="muted small">
              形の分析から見つかった変化の記録です。決まった進化ではなく、その時点の密度や輪郭を観察したものです。
            </p>
            {milestones.length === 0 && <p className="muted">まだ記録はありません。</p>}
            <ul className="milestones" data-testid="milestones">
              {milestones.map((m) => (
                <MilestoneItem key={m.id} m={m} pixels={pixels} />
              ))}
            </ul>
          </>
        ) : (
          <>
            <ul className="dot-log" data-testid="dot-log">
              {recent.map((p) => (
                <li key={p.id}>
                  <span className="swatch" style={{ background: p.color }} />
                  <div>
                    <div>
                      <strong>#{(p.growthIndex + 1).toLocaleString()}</strong>
                      <span className="muted"> {fmt.format(p.createdAt)}</span>
                    </div>
                    <div className="muted small">
                      総ドット数 {(p.growthIndex + 1).toLocaleString()} ・ {TIME_OF_DAY_LABEL[p.envUsed.timeOfDay]} ・ 天気 {WEATHER_LABEL[p.envUsed.weather]}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {limit < total && (
              <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>
                さらに表示（残り {(total - limit).toLocaleString()}）
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MilestoneItem({ m, pixels }: { m: Milestone; pixels: readonly Pixel[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawThumbnail(ref.current, pixels, m.metadata.pixelCount);
  }, [m, pixels]);
  return (
    <li>
      <canvas ref={ref} width={96} height={96} className="thumb" aria-hidden />
      <div>
        <div>{milestoneLabel(m)}</div>
        <div className="muted small">
          {fmt.format(m.achievedAt)} ・ {m.metadata.pixelCount.toLocaleString()} ドット
        </div>
      </div>
    </li>
  );
}
