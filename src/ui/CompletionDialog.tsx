import { useState } from 'react';
import { NameForm } from './NameForm';

interface Props {
  count: number;
  suggestName: () => Promise<string>;
  onSave: (name: string) => Promise<void>;
  onContinue: () => Promise<void>;
}

/** Shown once a creature reaches 30 days. Growth is paused until the player chooses. */
export function CompletionDialog({ count, suggestName, onSave, onContinue }: Props) {
  const [step, setStep] = useState<'choose' | 'name'>('choose');
  const [busy, setBusy] = useState(false);
  return (
    <div className="completion" role="dialog" aria-label="完成" data-testid="completion-dialog">
      <div className="completion-card">
        <div className="completion-eyebrow">30日目</div>
        <h2>{step === 'choose' ? '完成しました' : 'この子に名前をつけましょう'}</h2>
        {step === 'choose' ? (
          <>
            <p>{count.toLocaleString()}個のドットでできた姿になりました。新しい子を育てますか？</p>
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
            <p className="muted small">図鑑にしまった子は、この姿のまま残ります。育て続けても、あとで設定から図鑑にしまえます。</p>
          </>
        ) : (
          <NameForm initial={suggestName()} submitLabel="図鑑に保存して、新しい子を育てる" onSubmit={onSave} onCancel={() => setStep('choose')} cancelLabel="戻る" />
        )}
      </div>
    </div>
  );
}
