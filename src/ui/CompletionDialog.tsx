import { useState } from 'react';
import { ITEM_BY_ID, type GiftEntry } from '../core/items';
import { NameForm } from './NameForm';

interface Props {
  count: number;
  /** Days it took (15, or 30 for creatures started hourly). */
  days: number;
  gift: GiftEntry[] | null;
  suggestName: () => Promise<string>;
  onSave: (name: string) => Promise<void>;
  onContinue: () => Promise<void>;
}

/** Shown once a creature is complete (721 dots: 15 days, or 30 for hourly creatures). Abilities are final from here; dots keep coming meanwhile. */
export function CompletionDialog({ count, days, gift, suggestName, onSave, onContinue }: Props) {
  const [step, setStep] = useState<'choose' | 'name'>('choose');
  const [suggestion] = useState(() => suggestName()); // requested once
  const [busy, setBusy] = useState(false);
  return (
    <div className="completion" role="dialog" aria-label="完成" data-testid="completion-dialog">
      <div className="completion-card">
        <div className="completion-eyebrow">{days}日目</div>
        <h2>{step === 'choose' ? '完成しました' : 'この子に名前をつけましょう'}</h2>
        {step === 'choose' ? (
          <>
            <p>
              {days}日をむかえて、のうりょくが決まりました。新しい子を育てますか？
              <span className="muted small" data-testid="dot-count-now"> （いま {count.toLocaleString()} ドット）</span>
            </p>
            <p className="muted small" data-testid="keeps-growing-note">
              このままにしておくとドットは増え続けて、どんどん大きくなります（のうりょくは{days}日目のまま変わりません）。
            </p>
            {gift && gift.length > 0 && (
              <div className="gift" data-testid="gift">
                <div className="gift-title">お礼のプレゼントをもらったよ</div>
                <ul>
                  {gift.map((g) => {
                    const it = ITEM_BY_ID.get(g.itemId);
                    return it ? (
                      <li key={g.itemId}>
                        <span aria-hidden>{it.icon}</span> {it.name} ×{g.count}
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
            )}
            <div className="completion-actions">
              <button className="btn primary" data-testid="start-new-creature" onClick={() => setStep('name')}>
                名前をつけて図鑑にしまい、新しい子を育てる
              </button>
              <button
                className="btn"
                data-testid="keep-growing"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onContinue();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                このまま育て続ける
              </button>
            </div>
            <p className="muted small">図鑑にしまった子は、しまったときの姿のまま残ります。育て続けても、あとで設定から図鑑にしまえます。</p>
          </>
        ) : (
          <NameForm initial={suggestion} submitLabel="図鑑に保存して、新しい子を育てる" onSubmit={onSave} onCancel={() => setStep('choose')} cancelLabel="戻る" />
        )}
      </div>
    </div>
  );
}
