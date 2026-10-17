import { useState } from 'react';

interface Props {
  count: number;
  onNew: () => Promise<void>;
  onContinue: () => Promise<void>;
}

/** Shown once a creature reaches 30 days. Growth is paused until the player chooses. */
export function CompletionDialog({ count, onNew, onContinue }: Props) {
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="completion" role="dialog" aria-label="完成" data-testid="completion-dialog">
      <div className="completion-card">
        <div className="completion-eyebrow">30日目</div>
        <h2>完成しました</h2>
        <p>
          {count.toLocaleString()}個のドットでできた姿になりました。新しい子を育てますか？
        </p>
        <div className="completion-actions">
          <button className="btn primary" data-testid="start-new-creature" disabled={busy} onClick={run(onNew)}>
            図鑑にしまって、新しい子を育てる
          </button>
          <button className="btn" data-testid="keep-growing" disabled={busy} onClick={run(onContinue)}>
            このまま育て続ける
          </button>
        </div>
        <p className="muted small">図鑑にしまった子は、この姿のまま残ります。育て続けても、あとで設定から図鑑にしまえます。</p>
      </div>
    </div>
  );
}
