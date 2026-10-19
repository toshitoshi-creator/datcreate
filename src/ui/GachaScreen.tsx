import { useState } from 'react';
import { GACHA_COST, GACHA_RATES, GACHA_TEN_COST, MEDALS, RARITY_LABEL, STICKERS, bonusText, rarityStars, type Rarity, type StickerDef } from '../core/stickers';
import type { ControllerState, GameController } from '../engine/gameController';
import { useControllerState } from './hooks';

/** The sticker gacha (medals from battles) and the sticker book. */
export function GachaScreen({ controller, onClose }: { controller: GameController; onClose: () => void }) {
  const state: ControllerState = useControllerState(controller);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ got: StickerDef[]; fresh: Set<number> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'gacha' | 'book'>('gacha');
  const [detail, setDetail] = useState<StickerDef | null>(null);

  const pull = async (times: 1 | 10) => {
    setBusy(true);
    setError(null);
    const seenBefore = new Set(controller.getState().stickersSeen);
    try {
      const got = await controller.pullGacha(times);
      // NEW on the first copy of a sticker never drawn before
      const fresh = new Set<number>();
      got.forEach((s, i) => {
        if (!seenBefore.has(s.id)) {
          fresh.add(i);
          seenBefore.add(s.id);
        }
      });
      setResult({ got, fresh });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ownedCount = (id: string) => state.stickers[id] ?? 0;
  const seen = new Set(state.stickersSeen);
  const collected = STICKERS.filter((s) => seen.has(s.id)).length;

  return (
    <div className="sheet" role="dialog" aria-label="シールガチャ" data-testid="gacha-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={result ? () => setResult(null) : onClose} data-testid="close-gacha">
          ← 戻る
        </button>
        <h2>シールガチャ</h2>
        <span />
      </header>
      <div className="sheet-body">
        <div className="wallet">
          <span aria-hidden>🏅</span>
          <span className="wallet-coins" data-testid="medal-balance">{state.medals.toLocaleString()}</span>
          <small>メダル</small>
        </div>
        {error && <p className="notice err">{error}</p>}

        {result ? (
          <div className="gacha-result" data-testid="gacha-result">
            <ul className="sticker-grid big">
              {result.got.map((s, i) => (
                <li key={i} className={`sticker-card r${s.rarity}`} data-testid="gacha-got" style={{ animationDelay: `${i * 70}ms` }}>
                  {result.fresh.has(i) && <span className="new-badge">NEW</span>}
                  <span className="sticker-icon" aria-hidden>{s.icon}</span>
                  <span className="sticker-name">{s.name}</span>
                  <span className="stars">{rarityStars(s.rarity)}</span>
                  <span className="muted small">{bonusText(s)}</span>
                </li>
              ))}
            </ul>
            <div className="btn-row center">
              <button className="btn primary" data-testid="gacha-again" disabled={busy || state.medals < GACHA_COST} onClick={() => pull(1)}>
                もう1回（🏅{GACHA_COST}）
              </button>
              <button className="btn" onClick={() => setResult(null)}>
                とじる
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="chips tabs">
              <button className={`chip ${tab === 'gacha' ? 'selected' : ''}`} onClick={() => setTab('gacha')} data-testid="tab-gacha">
                ガチャ
              </button>
              <button className={`chip ${tab === 'book' ? 'selected' : ''}`} onClick={() => setTab('book')} data-testid="tab-book">
                シール帳 {collected}/{STICKERS.length}
              </button>
            </div>
            {tab === 'gacha' ? (
              <>
                <div className="gacha-machine" aria-hidden>
                  🎁
                </div>
                <div className="btn-row center">
                  <button className="btn primary" data-testid="gacha-1" disabled={busy || state.medals < GACHA_COST} onClick={() => pull(1)}>
                    1回ひく（🏅{GACHA_COST}）
                  </button>
                  <button className="btn" data-testid="gacha-10" disabled={busy || state.medals < GACHA_TEN_COST} onClick={() => pull(10)}>
                    10回ひく（🏅{GACHA_TEN_COST}）
                  </button>
                </div>
                <p className="muted small">
                  メダルは対決で勝つともらえます（やせいのドットに勝つと {MEDALS.wildWin}枚・1日{MEDALS.wildDailyCap}枚まで、ランク戦は勝ち {MEDALS.rankedWin}枚・負けても {MEDALS.rankedOther}枚）。
                  シールは1体に1枚はれて、見た目がかわり、レア度によって能力が少し上がります。
                </p>
                <table className="odds" data-testid="gacha-odds">
                  <tbody>
                    {([4, 3, 2, 1] as Rarity[]).map((r) => (
                      <tr key={r}>
                        <td className="stars">{rarityStars(r)}</td>
                        <td>{RARITY_LABEL[r]}</td>
                        <td className="muted small">{r === 1 ? '見た目だけ' : r === 4 ? '能力が2つ上がる' : '能力が1つ上がる'}</td>
                        <td className="num">{(GACHA_RATES[r] * 100).toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <ul className="sticker-grid" data-testid="sticker-book">
                  {STICKERS.map((s) => {
                    const n = ownedCount(s.id);
                    const known = seen.has(s.id);
                    return (
                      <li key={s.id}>
                        <button className={`sticker-card r${s.rarity} ${known ? '' : 'unknown'}`} disabled={!known} onClick={() => setDetail(s)} data-testid={`book-${s.id}`}>
                          <span className="sticker-icon" aria-hidden>{known ? s.icon : '？'}</span>
                          <span className="stars">{rarityStars(s.rarity)}</span>
                          {n > 0 && <span className="sticker-count">×{n}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {detail && (
                  <p className="notice" data-testid="sticker-detail">
                    {detail.icon} {detail.name}（{RARITY_LABEL[detail.rarity]}）: {bonusText(detail)}。図鑑の子やいまの子の「🏷 シール」からはれます。
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
