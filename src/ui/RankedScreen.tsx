import { useEffect, useMemo, useRef, useState } from 'react';
import type { BattleResult } from '../core/battle';
import { RANKED_DAILY_LIMIT, nextTier, seasonLabel, tierOf, type RankTier, type RankedRecord, type Rival } from '../core/ranked';
import { statsOf } from '../core/stats';
import { withSticker } from '../core/stickers';
import type { GameState, Pixel } from '../core/types';
import type { GameController } from '../engine/gameController';
import { FighterCard, FightView, MedalGain, STEP_MS, type Entry } from './BattleScreen';
import { PixelThumb } from './PixelThumb';

interface Props {
  controller: GameController;
  onPickChampion: () => void;
  onClose: () => void;
}

/** Practice ranked battles: the representative against CPU rivals, for rank points. */
export function RankedScreen({ controller, onPickChampion, onClose }: Props) {
  const [status, setStatus] = useState<{ rec: RankedRecord; champion: GameState | null } | null>(null);
  const [reward, setReward] = useState<{ season: string; tier: RankTier } | null>(null);
  const [champPixels, setChampPixels] = useState<Pixel[] | null>(null);
  const [rival, setRival] = useState<Rival | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fight, setFight] = useState<{ result: BattleResult; shown: number; before: number; after: number; medals: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  const reload = async () => {
    const s = await controller.rankedStatus();
    setStatus({ rec: s.rec, champion: s.champion });
    if (s.seasonReward) setReward(s.seasonReward);
    return s;
  };
  useEffect(() => {
    void reload().then((s) => s.champion && controller.loadCollectionPixels(s.champion.gameId).then(setChampPixels));
    return () => clearInterval(timer.current);
  }, [controller]);

  const champStats = useMemo(() => (champPixels ? withSticker(statsOf(champPixels), status?.champion?.sticker) : null), [champPixels, status?.champion?.sticker]);
  const champ = status?.champion ?? null;
  const me: Entry | null = champ ? { key: champ.gameId, name: champ.name ?? 'なまえのない子', pixels: champPixels, sticker: champ.sticker } : null;
  const them: Entry | null = rival ? { key: 'rival', name: rival.name, pixels: rival.pixels } : null;

  const search = () => {
    if (!status || !champ) return;
    setSearching(true);
    setError(null);
    // let the "searching" state paint; growing rivals takes a moment
    setTimeout(() => {
      setRival(controller.rivalFor(status.rec, champ.gameId));
      setSearching(false);
    }, 30);
  };

  const start = async () => {
    if (!status || !champ || !rival || !champStats || !me) return;
    try {
      const r = await controller.playRanked(champStats, me.name, rival, status.rec, champ.gameId);
      setStatus({ rec: r.rec, champion: champ });
      setFight({ result: r.battle, shown: 0, before: r.before, after: r.after, medals: r.medals });
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        setFight((f) => {
          if (!f || f.shown >= f.result.events.length) {
            clearInterval(timer.current);
            return f;
          }
          return { ...f, shown: f.shown + 1 };
        });
      }, STEP_MS);
    } catch (e) {
      setError((e as Error).message);
      setRival(null);
      void reload();
    }
  };

  const back = () => {
    if (fight) {
      clearInterval(timer.current);
      setFight(null);
      setRival(null);
      return;
    }
    if (rival) return setRival(null);
    onClose();
  };

  const rec = status?.rec;
  const left = rec ? Math.max(0, RANKED_DAILY_LIMIT - rec.played) : 0;
  const tier = rec ? tierOf(rec.rating) : null;
  const next = rec ? nextTier(rec.rating) : null;

  return (
    <div className="sheet" role="dialog" aria-label="ランク戦" data-testid="ranked-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={back} data-testid="close-ranked">
          ← 戻る
        </button>
        <h2>ランク戦（練習）</h2>
        <span />
      </header>
      <div className="sheet-body">
        {reward && (
          <div className="notice ok" role="status" data-testid="season-reward">
            {seasonLabel(reward.season)}の結果: {reward.tier.icon} {reward.tier.name}　ほうしゅう 🪙 {reward.tier.seasonCoins}
            <button className="text-btn" onClick={() => setReward(null)}>
              とじる
            </button>
          </div>
        )}
        {error && <p className="notice err">{error}</p>}
        {!rec || !tier ? null : fight && me && them && champStats && rival ? (
          <FightView
            me={me}
            them={them}
            myStats={champStats}
            theirStats={rival.stats}
            fight={{ result: fight.result, shown: fight.shown, reward: null }}
            onSkip={() => setFight((f) => (f ? { ...f, shown: f.result.events.length } : f))}
            extra={<><RankChange before={fight.before} after={fight.after} /><MedalGain n={fight.medals} /></>}
          />
        ) : (
          <>
            <div className="rank-card" data-testid="rank-card">
              <div className="rank-season muted small">{seasonLabel(rec.season)}</div>
              <div className="rank-tier">
                <span className="rank-icon" aria-hidden>
                  {tier.icon}
                </span>
                <span data-testid="rank-tier">{tier.name}</span>
                <span className="rank-points" data-testid="rank-points">
                  {rec.rating}
                </span>
                <small>pt</small>
              </div>
              <div className="muted small">{next ? `${next.tier.icon} ${next.tier.name}まで あと ${next.need}pt` : 'いちばん上のランクです！'}</div>
              <div className="rank-record small" data-testid="rank-record">
                {rec.wins}勝 {rec.losses}敗{rec.draws ? ` ${rec.draws}分` : ''} ・ 今日はあと<span data-testid="ranked-left">{left}</span>回（1日{RANKED_DAILY_LIMIT}回）
              </div>
            </div>

            {!champ ? (
              <div className="empty-collection">
                <p>ランク戦に出る「代表」がいません。</p>
                <p className="muted small">図鑑にいる完成した子から1体えらんでね。</p>
                <button className="btn primary" data-testid="pick-champion" onClick={onPickChampion}>
                  ★ 代表をえらぶ
                </button>
              </div>
            ) : rival && them ? (
              <>
                <div className="versus">
                  {me && <FighterCard entry={me} stats={champStats} testId="mine-stats" />}
                  <div className="vs-mark">VS</div>
                  <div>
                    <FighterCard entry={them} stats={rival.stats} testId="their-stats" />
                    <div className="muted small center">{tierOf(rival.rating).icon} {rival.rating}pt</div>
                  </div>
                </div>
                <button className="btn primary wide" data-testid="start-ranked" disabled={!champStats || left <= 0} onClick={start}>
                  たたかう！
                </button>
              </>
            ) : (
              <>
                <div className="champion-row" data-testid="champion">
                  <PixelThumb pixels={champPixels} size={84} sticker={champ.sticker} />
                  <div className="champion-text">
                    <div className="muted small">代表</div>
                    <div className="fighter-name">{champ.name ?? 'なまえのない子'}</div>
                    <button className="text-btn" data-testid="change-champion" onClick={onPickChampion}>
                      代表をかえる
                    </button>
                  </div>
                </div>
                <button className="btn primary wide" data-testid="find-rival" disabled={searching || left <= 0} onClick={search}>
                  {searching ? 'あいてをさがしています…' : left > 0 ? 'あいてをさがす' : '今日のランク戦はおしまい'}
                </button>
                <p className="muted small">
                  勝つと +20pt、負けると −15pt。ランクが上がるほどライバルも強くなります。今いるランクより下には落ちません。月ごとのシーズンが終わると、いちばん高かったランクに応じてコインがもらえます。
                </p>
              </>
            )}

            {rec.history.length > 0 && !rival && (
              <section className="section">
                <h3>さいきんの対戦</h3>
                <ul className="rank-history" data-testid="rank-history">
                  {rec.history.slice(0, 10).map((h) => (
                    <li key={h.at}>
                      <span className={`rh-result ${h.result}`}>{h.result === 'win' ? '勝ち' : h.result === 'loss' ? '負け' : '引分'}</span>
                      <span className="rh-rival">{h.rival}</span>
                      <span className="rh-delta">{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RankChange({ before, after }: { before: number; after: number }) {
  const d = after - before;
  const up = tierOf(after).min > tierOf(before).min;
  return (
    <div className="rank-change" data-testid="rank-change">
      <div>
        {before}pt → <b>{after}pt</b>（{d >= 0 ? `+${d}` : d}）
      </div>
      {up && (
        <div className="rank-up" data-testid="rank-up">
          {tierOf(after).icon} {tierOf(after).name}に昇格！
        </div>
      )}
    </div>
  );
}
