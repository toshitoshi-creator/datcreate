import { useState } from 'react';
import { STICKERS, STICKER_BY_ID, bonusText, rarityStars } from '../core/stickers';

interface Props {
  /** The sticker the creature has now. */
  current: string | null | undefined;
  stock: Record<string, number>;
  onPick: (stickerId: string | null) => Promise<void>;
  onOpenGacha?: () => void;
  onClose: () => void;
}

/** Choose the sticker for one creature (one at most; the old one goes back to the stock). */
export function StickerPicker({ current, stock, onPick, onOpenGacha, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = STICKERS.filter((s) => (stock[s.id] ?? 0) > 0).sort((a, b) => b.rarity - a.rarity);
  const now = current ? STICKER_BY_ID.get(current) : undefined;
  const pick = async (id: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await onPick(id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="item-sheet-backdrop" onClick={onClose}>
      <div className="item-sheet" role="dialog" aria-label="シール" data-testid="sticker-picker" onClick={(e) => e.stopPropagation()}>
        <div className="item-sheet-head">
          <h3>シールをはる</h3>
          <button className="text-btn" onClick={onClose} data-testid="close-sticker-picker">
            とじる
          </button>
        </div>
        <p className="muted small" data-testid="current-sticker">
          {now ? `いまのシール: ${now.icon} ${now.name}（${bonusText(now)}）` : 'シールははっていません。'} 1体に1枚まで。はりかえると前のシールは手元にもどります。
        </p>
        {error && <p className="notice err">{error}</p>}
        {owned.length === 0 ? (
          <div className="item-empty">
            手元にシールがありません。対決でメダルをあつめて、ガチャでもらおう。
            {onOpenGacha && (
              <div className="btn-row center">
                <button className="btn" data-testid="picker-open-gacha" onClick={onOpenGacha}>
                  🎁 シールガチャへ
                </button>
              </div>
            )}
          </div>
        ) : (
          <ul className="sticker-grid">
            {owned.map((s) => (
              <li key={s.id}>
                <button className={`sticker-card r${s.rarity}`} disabled={busy} onClick={() => pick(s.id)} data-testid={`pick-sticker-${s.id}`}>
                  <span className="sticker-icon" aria-hidden>{s.icon}</span>
                  <span className="sticker-name">{s.name}</span>
                  <span className="stars">{rarityStars(s.rarity)}</span>
                  <span className="muted small">{bonusText(s)}</span>
                  <span className="sticker-count">×{stock[s.id]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {now && (
          <div className="btn-row center">
            <button className="btn" disabled={busy} onClick={() => pick(null)} data-testid="remove-sticker">
              シールをはがす
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
