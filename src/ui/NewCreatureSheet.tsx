import { useState } from 'react';
import { NameForm } from './NameForm';

interface Props {
  count: number;
  days: number;
  suggestName: () => Promise<string>;
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Put the finished creature in the collection (with a name) and start a new one. */
export function NewCreatureSheet({ count, days, suggestName, onSave, onClose }: Props) {
  const [suggestion] = useState(() => suggestName()); // requested once
  return (
    <div className="item-sheet-backdrop" onClick={onClose}>
      <div className="item-sheet" role="dialog" aria-label="新しい子を育てる" data-testid="new-creature-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="item-sheet-head">
          <h3>新しい子を育てる</h3>
          <button className="text-btn" onClick={onClose} data-testid="close-new-creature">
            とじる
          </button>
        </div>
        <p className="muted small">いまの子（{count.toLocaleString()}ドット）は名前をつけて図鑑にしまいます。のうりょくは{days}日目のまま残ります。</p>
        <NameForm initial={suggestion} submitLabel="図鑑に保存して、新しい子を育てる" onSubmit={onSave} onCancel={onClose} />
      </div>
    </div>
  );
}
