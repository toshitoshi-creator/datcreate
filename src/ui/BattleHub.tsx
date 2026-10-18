import { useEffect, useState } from 'react';
import { tierOf } from '../core/ranked';
import type { GameController } from '../engine/gameController';
import { BattleScreen } from './BattleScreen';
import { CollectionScreen } from './CollectionScreen';
import { RankedScreen } from './RankedScreen';

type View = 'hub' | 'wild' | 'collection' | 'ranked' | 'champion';

/** The battle menu: practice ranked battles, or a free battle against a wild dot. */
export function BattleHub({ controller, hasActive, onClose }: { controller: GameController; hasActive: boolean; onClose: () => void }) {
  const [view, setView] = useState<View>('hub');
  const [summary, setSummary] = useState<{ rating: number; champion: boolean } | null>(null);
  useEffect(() => {
    if (view === 'hub') void controller.rankedStatus().then((s) => setSummary({ rating: s.rec.rating, champion: !!s.champion }));
  }, [controller, view]);

  if (view === 'wild') return <BattleScreen controller={controller} onClose={() => setView('hub')} />;
  if (view === 'collection') return <CollectionScreen controller={controller} forBattle onClose={() => setView('hub')} />;
  if (view === 'champion') return <CollectionScreen controller={controller} mode="champion" onChampionChosen={() => setView('ranked')} onClose={() => setView('ranked')} />;
  if (view === 'ranked') return <RankedScreen controller={controller} onPickChampion={() => setView('champion')} onClose={() => setView('hub')} />;

  const tier = summary ? tierOf(summary.rating) : null;
  return (
    <div className="sheet" role="dialog" aria-label="対決" data-testid="battle-hub">
      <header className="sheet-header">
        <button className="text-btn" onClick={onClose} data-testid="close-hub">
          ← 戻る
        </button>
        <h2>対決</h2>
        <span />
      </header>
      <div className="sheet-body hub-body">
        <button className="hub-card ranked" data-testid="hub-ranked" onClick={() => setView('ranked')}>
          <span className="hub-title">🏆 ランク戦（練習）</span>
          <span className="muted small">代表の子でライバルと戦って、ランクを上げよう</span>
          {tier && summary && (
            <span className="hub-rank">
              {tier.icon} {tier.name} {summary.rating}pt{summary.champion ? '' : '・代表をえらんでね'}
            </span>
          )}
        </button>
        {hasActive && (
          <button className="hub-card" data-testid="hub-wild" onClick={() => setView('wild')}>
            <span className="hub-title">🌿 いまの子で対決</span>
            <span className="muted small">育てている子が、やせいのドットと戦います</span>
          </button>
        )}
        <button className="hub-card" data-testid="hub-collection" onClick={() => setView('collection')}>
          <span className="hub-title">▦ 図鑑の子で対決</span>
          <span className="muted small">図鑑から子をえらんで、やせいのドットと戦います</span>
        </button>
        <p className="muted small">対決しても成長には影響しません。ユーザー同士の対戦は、今後オンライン対応で追加予定です。</p>
      </div>
    </div>
  );
}
