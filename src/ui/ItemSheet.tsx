import { useState } from 'react';
import { ITEMS, type Inventory, type ItemKind } from '../core/items';

interface Props {
  kind: ItemKind;
  inventory: Inventory;
  onUse: (itemId: string) => Promise<void>;
  onClose: () => void;
}

const TITLE: Record<ItemKind, string> = { food: 'ごはんをあげる', toy: 'いっしょにあそぶ' };

/** Item picker. Using an item never adds a dot; it brings the next growth earlier. */
export function ItemSheet({ kind, inventory, onUse, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const items = ITEMS.filter((i) => i.kind === kind);
  const owned = items.filter((i) => (inventory[i.id] ?? 0) > 0);
  return (
    <div className="item-sheet-backdrop" onClick={onClose}>
      <div className="item-sheet" role="dialog" aria-label={TITLE[kind]} data-testid={`item-sheet-${kind}`} onClick={(e) => e.stopPropagation()}>
        <div className="item-sheet-head">
          <h3>{TITLE[kind]}</h3>
          <button className="text-btn" onClick={onClose} data-testid="close-items">
            とじる
          </button>
        </div>
        <p className="muted small">使うと次にドットが増えるタイミングがはやくなります（その場でドットは増えません）。</p>
        {owned.length === 0 && <p className="item-empty">持っているアイテムがありません。15日育てて完成すると、お礼にもらえます。</p>}
        <ul className="item-grid">
          {items.map((it) => {
            const n = inventory[it.id] ?? 0;
            return (
              <li key={it.id}>
                <button
                  className="item-tile"
                  data-testid={`item-${it.id}`}
                  disabled={busy || n === 0}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onUse(it.id);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <span className="item-icon" aria-hidden>
                    {it.icon}
                  </span>
                  <span className="item-name">{it.name}</span>
                  <span className="item-meta">
                    −{it.minutes}分{it.rare ? '・レア' : ''}
                  </span>
                  <span className="item-count" data-testid={`count-${it.id}`}>
                    ×{n}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
