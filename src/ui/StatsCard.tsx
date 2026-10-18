import { STAT_LABEL, STAT_MAX, type Stats } from '../core/stats';

const CORE = ['strength', 'defense', 'speed', 'luck'] as const;

/** Six stats: HP / スタミナ out of 200, the other four always add up to 100. */
export function StatsCard({ stats, testId }: { stats: Stats; testId?: string }) {
  return (
    <div className="stats-card" data-testid={testId}>
      {(['hp', 'stamina'] as const).map((k) => (
        <StatRow key={k} label={STAT_LABEL[k]} value={stats[k]} max={STAT_MAX[k]} kind={k} />
      ))}
      {CORE.map((k) => (
        <StatRow key={k} label={STAT_LABEL[k]} value={stats[k]} max={60} kind={k} />
      ))}
      <div className="stats-note muted">下の4つの合計 {stats.strength + stats.defense + stats.speed + stats.luck}</div>
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
