import { useEffect, useMemo, useRef, useState } from 'react';
import { simulateBattle, type BattleEvent, type BattleResult, type Side } from '../core/battle';
import type { ItemDef } from '../core/items';
import { freshSeed } from '../core/rng';
import { statsFromColors, type Stats } from '../core/stats';
import type { GameState, Pixel } from '../core/types';
import { growWildDot } from '../core/wild';
import type { GameController } from '../engine/gameController';
import { PixelThumb } from './PixelThumb';
import { StatsCard } from './StatsCard';

interface Entry {
  key: string;
  name: string;
  pixels: Pixel[] | null;
}

const STEP_MS = 650;

/** A small, friendly battle. It never affects growth; the first win each day earns an item. */
export function BattleScreen({ controller, onClose }: { controller: GameController; onClose: () => void }) {
  const [collection, setCollection] = useState<GameState[]>([]);
  const [loaded, setLoaded] = useState<Record<string, Pixel[]>>({});
  const active = controller.pixels.length ? controller.pixels : null;
  const [mine, setMine] = useState<string>(active ? 'active' : '');
  const [theirs, setTheirs] = useState<string>('wild');
  const [wildSeed, setWildSeed] = useState(() => freshSeed());

  useEffect(() => {
    void controller.listCollection().then((l) => {
      setCollection(l);
      if (!active && l[0]) setMine(l[0].gameId);
    });
  }, [controller]);

  const load = (gameId: string) => {
    if (loaded[gameId]) return;
    void controller.loadCollectionPixels(gameId).then((p) => setLoaded((m) => ({ ...m, [gameId]: p })));
  };
  useEffect(() => {
    for (const id of [mine, theirs]) if (id && id !== 'active' && id !== 'wild') load(id);
  }, [mine, theirs]);

  const myBase = active ? controller.pixels.length : 721;
  const wildPixels = useMemo(() => {
    const n = Math.max(30, Math.min(721, Math.round(myBase * (0.85 + (wildSeed % 30) / 100))));
    return growWildDot(wildSeed, n);
  }, [wildSeed, myBase]);

  const entry = (key: string): Entry | null => {
    if (key === 'active') return active ? { key, name: 'いまの子', pixels: active } : null;
    if (key === 'wild') return { key, name: 'やせいのドット', pixels: wildPixels };
    const g = collection.find((c) => c.gameId === key);
    return g ? { key, name: g.name ?? 'なまえのない子', pixels: loaded[key] ?? null } : null;
  };
  const me = entry(mine);
  const them = entry(theirs);
  const myStats = useMemo(() => (me?.pixels ? statsFromColors(me.pixels.map((p) => p.color)) : null), [me?.pixels]);
  const theirStats = useMemo(() => (them?.pixels ? statsFromColors(them.pixels.map((p) => p.color)) : null), [them?.pixels]);

  const [fight, setFight] = useState<{ result: BattleResult; shown: number; reward: ItemDef | null | undefined } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  useEffect(() => () => clearInterval(timer.current), []);

  const start = () => {
    if (!me || !them || !myStats || !theirStats) return;
    const result = simulateBattle({ name: me.name, stats: myStats }, { name: them.name, stats: theirStats }, freshSeed());
    setFight({ result, shown: 0, reward: undefined });
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      setFight((f) => {
        if (!f) return f;
        if (f.shown >= f.result.events.length) {
          clearInterval(timer.current);
          return f;
        }
        return { ...f, shown: f.shown + 1 };
      });
    }, STEP_MS);
  };

  const done = !!fight && fight.shown >= fight.result.events.length;
  useEffect(() => {
    if (done && fight && fight.reward === undefined) {
      void controller.rewardBattle(fight.result.winner === 'a').then((item) => setFight((f) => (f ? { ...f, reward: item } : f)));
    }
  }, [done]);

  const opponents: { key: string; label: string }[] = [{ key: 'wild', label: 'やせいのドット' }, ...collection.filter((c) => c.gameId !== mine).map((c) => ({ key: c.gameId, label: c.name ?? 'なまえのない子' }))];
  const fighters: { key: string; label: string }[] = [...(active ? [{ key: 'active', label: 'いまの子' }] : []), ...collection.filter((c) => c.gameId !== theirs).map((c) => ({ key: c.gameId, label: c.name ?? 'なまえのない子' }))];

  return (
    <div className="sheet" role="dialog" aria-label="対決" data-testid="battle-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={fight ? () => { clearInterval(timer.current); setFight(null); } : onClose} data-testid="close-battle">
          ← 戻る
        </button>
        <h2>対決</h2>
        <span />
      </header>
      <div className="sheet-body">
        {fight && me && them && myStats && theirStats ? (
          <FightView me={me} them={them} myStats={myStats} theirStats={theirStats} fight={fight} onSkip={() => setFight((f) => (f ? { ...f, shown: f.result.events.length } : f))} onAgain={() => { setFight(null); if (theirs === 'wild') setWildSeed(freshSeed()); }} />
        ) : !me ? (
          <p className="muted">対決できる子がいません。育てている子か、図鑑の子が必要です。</p>
        ) : (
          <>
            <p className="muted small">ドットの色でステータスが決まります。対決しても成長には影響しません。1日の最初の勝利で、アイテムを1つもらえます。</p>
            <Picker title="あなたの子" options={fighters} value={mine} onChange={setMine} testId="pick-mine" />
            <Picker title="あいて" options={opponents} value={theirs} onChange={(k) => { setTheirs(k); if (k === 'wild') setWildSeed(freshSeed()); }} testId="pick-theirs" />
            <div className="versus">
              <FighterCard entry={me} stats={myStats} testId="mine-stats" />
              <div className="vs-mark">VS</div>
              {them && <FighterCard entry={them} stats={theirStats} testId="their-stats" />}
            </div>
            <button className="btn primary wide" data-testid="start-battle" disabled={!myStats || !theirStats} onClick={start}>
              たたかう！
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Picker({ title, options, value, onChange, testId }: { title: string; options: { key: string; label: string }[]; value: string; onChange: (k: string) => void; testId: string }) {
  return (
    <div className="picker" data-testid={testId}>
      <div className="picker-title">{title}</div>
      <div className="chips">
        {options.map((o) => (
          <button key={o.key} className={`chip ${o.key === value ? 'selected' : ''}`} aria-pressed={o.key === value} onClick={() => onChange(o.key)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FighterCard({ entry, stats, testId }: { entry: Entry; stats: Stats | null; testId: string }) {
  return (
    <div className="fighter">
      <PixelThumb pixels={entry.pixels} size={120} />
      <div className="fighter-name">{entry.name}</div>
      {stats ? <StatsCard stats={stats} testId={testId} /> : <div className="muted small">よみこみ中…</div>}
    </div>
  );
}

function message(e: BattleEvent, names: Record<Side, string>): string {
  const me = names[e.actor], you = names[e.actor === 'a' ? 'b' : 'a'];
  switch (e.kind) {
    case 'attack': return `${me}のこうげき！ ${e.damage}のダメージ`;
    case 'critical': return `${me}のかいしんの一撃！ ${e.damage}のダメージ`;
    case 'dodge': return `${you}はひらりとかわした！`;
    case 'rest': return `${me}はひと休みしてスタミナを回復した`;
    case 'ko': return `${me}はたおれた…`;
    case 'timeup': return 'じかんぎれ！ のこりHPで勝負！';
  }
}

interface FightProps {
  me: Entry;
  them: Entry;
  myStats: Stats;
  theirStats: Stats;
  fight: { result: BattleResult; shown: number; reward: ItemDef | null | undefined };
  onSkip: () => void;
  onAgain: () => void;
}

function FightView({ me, them, myStats, theirStats, fight, onSkip, onAgain }: FightProps) {
  const names = { a: me.name, b: them.name };
  const last = fight.shown > 0 ? fight.result.events[fight.shown - 1] : null;
  const hp = last?.hp ?? { a: myStats.hp, b: theirStats.hp };
  const st = last?.stamina ?? { a: myStats.stamina, b: theirStats.stamina };
  const done = fight.shown >= fight.result.events.length;
  const hit = last && (last.kind === 'attack' || last.kind === 'critical') ? (last.actor === 'a' ? 'b' : 'a') : null;
  const log = fight.result.events.slice(0, fight.shown).map((e) => message(e, names)).reverse();
  const w = fight.result.winner;
  return (
    <div className="fight" data-testid="fight">
      <div className="arena">
        {(['a', 'b'] as const).map((s) => {
          const e = s === 'a' ? me : them;
          const max = (s === 'a' ? myStats : theirStats);
          return (
            <div key={`${s}-${fight.shown}`} className={`arena-side ${hit === s ? 'hit' : ''} ${last?.actor === s && hit ? 'lunge-' + s : ''}`}>
              <PixelThumb pixels={e.pixels} size={130} />
              <div className="fighter-name">{e.name}</div>
              <Bar label="HP" value={hp[s]} max={max.hp} kind="hp" testId={`hp-${s}`} />
              <Bar label="スタミナ" value={st[s]} max={max.stamina} kind="stamina" />
            </div>
          );
        })}
      </div>
      {done ? (
        <div className={`result ${w === 'a' ? 'win' : w === 'b' ? 'lose' : 'draw'}`} data-testid="battle-result">
          <div className="result-title">{w === 'a' ? 'かち！' : w === 'b' ? 'まけ…' : 'ひきわけ'}</div>
          {fight.reward && (
            <div data-testid="battle-reward">
              きょうの勝利ボーナス: {fight.reward.icon} {fight.reward.name} ×1
            </div>
          )}
          <div className="btn-row center">
            <button className="btn primary" data-testid="battle-again" onClick={onAgain}>
              もう一度
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row center">
          <button className="btn" data-testid="skip-battle" onClick={onSkip}>
            スキップ
          </button>
        </div>
      )}
      <ol className="battle-log" data-testid="battle-log">
        {log.map((m, i) => (
          <li key={log.length - i}>{m}</li>
        ))}
      </ol>
    </div>
  );
}

function Bar({ label, value, max, kind, testId }: { label: string; value: number; max: number; kind: string; testId?: string }) {
  return (
    <div className="mini-bar">
      <span className="mini-label">{label}</span>
      <span className="stat-bar">
        <span className={`stat-fill stat-${kind}`} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
      </span>
      <span className="stat-value" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
