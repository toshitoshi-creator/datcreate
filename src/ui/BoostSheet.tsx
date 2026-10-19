import { useState } from 'react';
import { BOOST_RATE } from '../core/schedule';
import { BOOSTS } from '../core/shop';
import type { Inventory } from '../core/items';

interface Props {
  inventory: Inventory;
  /** Dots a day at this creature's pace. */
  perDay: number;
  onUse: (boostId: string) => Promise<void>;
  onOpenShop: () => void;
  onClose: () => void;
}

/** Pace-up items the player owns. Using one speeds growth up; it never adds a dot on the spot. */
export function BoostSheet({ inventory, perDay, onUse, onOpenShop, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const owned = BOOSTS.filter((b) => (inventory[b.id] ?? 0) > 0);
  return (
    <div className="item-sheet-backdrop" onClick={onClose}>
      <div className="item-sheet" role="dialog" aria-label="時短アイテム" data-testid="boost-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="item-sheet-head">
          <h3>時短アイテム</h3>
          <button className="text-btn" onClick={onClose} data-testid="close-boosts">
            とじる
          </button>
        </div>
        <p className="muted small">使うと、ドットが増えるペースが{BOOST_RATE}倍になります（1日ぶん＝約{24 / BOOST_RATE}時間で{perDay}ドット）。使ったその場ではドットは増えません。</p>
        {owned.length === 0 ? (
          <div className="item-empty">
            持っている時短アイテムがありません。
            <div className="btn-row center">
              <button className="btn" data-testid="boost-open-shop" onClick={onOpenShop}>
                🪙 ショップへ
              </button>
            </div>
          </div>
        ) : (
          <ul className="boost-list">
            {owned.map((b) => (
              <li key={b.id} className="boost-row">
                <span className="boost-icon" aria-hidden>
                  {b.icon}
                </span>
                <span className="boost-text">
                  <span className="boost-name">{b.name}</span>
                  <span className="muted small">
                    {b.days}日ぶん（約{Math.round((b.days * 24) / BOOST_RATE)}時間で） ・ ×<span data-testid={`boost-count-${b.id}`}>{inventory[b.id]}</span>
                  </span>
                </span>
                {confirm === b.id ? (
                  <span className="boost-confirm">
                    <button className="btn small" onClick={() => setConfirm(null)}>
                      やめる
                    </button>
                    <button
                      className="btn small primary-lite"
                      data-testid={`confirm-boost-${b.id}`}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await onUse(b.id);
                        } finally {
                          setBusy(false);
                          setConfirm(null);
                        }
                      }}
                    >
                      使う
                    </button>
                  </span>
                ) : (
                  <button className="btn small" data-testid={`use-${b.id}`} onClick={() => setConfirm(b.id)}>
                    使う
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
