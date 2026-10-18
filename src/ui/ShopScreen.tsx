import { useState } from 'react';
import { AD_DAILY_LIMIT, AD_REWARD_COINS, BOOSTS } from '../core/shop';
import type { ControllerState, GameController } from '../engine/gameController';

interface Props {
  controller: GameController;
  state: ControllerState;
  onClose: () => void;
}

/** Buy coins (App Store / Google Play) and exchange them for pace-up items. */
export function ShopScreen({ controller, state, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const packs = controller.coinPacks();

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ kind: 'ok', text });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet" role="dialog" aria-label="ショップ" data-testid="shop-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={onClose} data-testid="close-shop">
          ← 戻る
        </button>
        <h2>ショップ</h2>
        <span />
      </header>
      <div className="sheet-body">
        <div className="wallet">
          <span aria-hidden>🪙</span>
          <span className="wallet-coins" data-testid="coin-balance">{state.coins.toLocaleString()}</span>
          <small>コイン</small>
        </div>
        {msg && (
          <p className={`notice ${msg.kind}`} role="status" data-testid="shop-message">
            {msg.text}
          </p>
        )}

        <section className="section">
          <h3>広告を見てもらう</h3>
          {state.ads === 'none' ? (
            <p className="muted small" data-testid="ads-unavailable">広告を見てコインをもらうのは、アプリ版（iPhone / Android）でできます。</p>
          ) : (
            <>
              {state.ads === 'test' && <p className="notice" data-testid="test-ad-note">お試し版なので、本物の広告のかわりに少し待つだけです。</p>}
              <button
                className="btn wide ad-btn"
                data-testid="watch-ad"
                disabled={busy || state.adsLeftToday <= 0}
                onClick={() =>
                  run(async () => {
                    const got = await controller.watchAdForCoins();
                    return got > 0 ? `${got}コインもらいました！` : '最後まで見ると、コインがもらえます';
                  })
                }
              >
                {busy && state.ads === 'test' ? '広告を再生中…' : `▶ 広告を見て 🪙 ${AD_REWARD_COINS} もらう`}
              </button>
              <p className="muted small" data-testid="ads-left">
                {state.adsLeftToday > 0 ? `今日はあと${state.adsLeftToday}回（1日${AD_DAILY_LIMIT}回まで）` : '今日の広告はおしまい。また明日見てね'}
              </p>
            </>
          )}
        </section>

        <section className="section">
          <h3>コインを買う</h3>
          {state.shop === 'none' ? (
            <p className="muted small" data-testid="shop-unavailable">コインの購入は、アプリ版（iPhone / Android）でできます。</p>
          ) : (
            <>
              {state.shop === 'test' && (
                <p className="notice" data-testid="test-store-note">お試し版のテスト購入です。お金はかかりません。</p>
              )}
              <ul className="shop-grid">
                {packs.map((p) => (
                  <li key={p.productId}>
                    <button
                      className="shop-tile"
                      data-testid={`buy-${p.productId}`}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const before = controller.getState().coins;
                          const ok = await controller.buyCoins(p.productId);
                          if (!ok) return null;
                          const got = controller.getState().coins - before;
                          return got > 0 ? `${got.toLocaleString()}コインを受け取りました` : '購入を受け付けました。まもなくコインが届きます';
                        })
                      }
                    >
                      <span className="shop-coins">🪙 {p.coins.toLocaleString()}</span>
                      <span className="shop-price">{p.price}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="section">
          <h3>時短アイテムと交換</h3>
          <p className="muted small">使うと、そのあいだドットが増えるペースが6倍になり、完成が早まります（使ったその場ではドットは増えません）。</p>
          <ul className="boost-list">
            {BOOSTS.map((b) => {
              const owned = state.inventory[b.id] ?? 0;
              const enough = state.coins >= b.cost;
              return (
                <li key={b.id} className="boost-row" data-testid={`shop-${b.id}`}>
                  <span className="boost-icon" aria-hidden>
                    {b.icon}
                  </span>
                  <span className="boost-text">
                    <span className="boost-name">{b.name}</span>
                    <span className="muted small">
                      {b.days}日ぶん短縮 ・ もっている ×<span data-testid={`owned-${b.id}`}>{owned}</span>
                    </span>
                  </span>
                  {confirm === b.id ? (
                    <span className="boost-confirm">
                      <button className="btn small" onClick={() => setConfirm(null)}>
                        やめる
                      </button>
                      <button
                        className="btn small primary-lite"
                        data-testid={`confirm-exchange-${b.id}`}
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            setConfirm(null);
                            const got = await controller.exchangeBoost(b.id);
                            return `${got.icon} ${got.name}と交換しました`;
                          })
                        }
                      >
                        交換
                      </button>
                    </span>
                  ) : (
                    <button className="btn small coin-btn" data-testid={`exchange-${b.id}`} disabled={busy || !enough} onClick={() => setConfirm(b.id)}>
                      🪙 {b.cost}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <p className="muted small">
          コインと時短アイテムは、この端末に保存されます。リセットやセーブデータの読み込みでは消えませんが、アプリを削除すると消えます。
        </p>
      </div>
    </div>
  );
}
