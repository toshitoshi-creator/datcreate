import { GEMS, GEM_ORDER, countGems } from '../core/gems';
import { STAT_LABEL, STAT_MAX, TOTAL_MAX, type Stats } from '../core/stats';
import type { Pixel } from '../core/types';

const CORE = ['strength', 'defense', 'speed', 'luck'] as const;

/** Six stats: HP / スタミナ out of 200; the other four add up to the ability total (max 150). */
export function StatsCard({ stats, testId, pixels }: { stats: Stats; testId?: string; pixels?: readonly Pixel[] | null }) {
  const total = stats.strength + stats.defense + stats.speed + stats.luck;
  return (
    <div className="stats-card" data-testid={testId}>
      {(['hp', 'stamina'] as const).map((k) => (
        <StatRow key={k} label={STAT_LABEL[k]} value={stats[k]} max={STAT_MAX[k]} kind={k} />
      ))}
      {CORE.map((k) => (
        <StatRow key={k} label={STAT_LABEL[k]} value={stats[k]} max={80} kind={k} />
      ))}
      <div className="stats-note muted">
        のうりょく合計 <b className="stats-total" data-testid="stat-total">{total}</b> / {TOTAL_MAX}
      </div>
      {pixels && <GemRow pixels={pixels} />}
    </div>
  );
}

function StatRow({ label, value, max, kind }: { label: string; value: number; max: number; kind: keyof Stats }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-bar">
        <span className={`stat-fill stat-${kind}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
      </span>
      <span className="stat-value" data-testid={`stat-${kind}`}>
        {value}
      </span>
    </div>
  );
}

/** Precious dots a creature has, rarest first. */
export function GemRow({ pixels }: { pixels: readonly Pixel[] }) {
  const n = countGems(pixels);
  const any = GEM_ORDER.some((k) => n[k] > 0);
  return (
    <div className="gem-row" data-testid="gem-row">
      {any ? (
        GEM_ORDER.filter((k) => n[k] > 0).map((k) => (
          <span key={k} className={`gem-chip gem-${k}`} title={GEMS[k].name} data-testid={`gems-${k}`}>
            {GEMS[k].icon}×{n[k]}
          </span>
        ))
      ) : (
        <span className="muted small">きらきらドットはまだありません</span>
      )}
    </div>
  );
}
