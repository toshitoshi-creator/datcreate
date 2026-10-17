import { useState } from 'react';

export function StartScreen({ onStart }: { onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="center-screen start-screen">
      <div className="splash-dot" />
      <h1 className="title">DOT LIFE</h1>
      <p className="lead">
        ここに1つのドットが生まれます。
        <br />
        現実の1時間ごとに、1つずつ増えていきます。
        <br />
        どんな存在になるかは、時間と環境しだい。
      </p>
      <button
        className="btn primary"
        data-testid="start-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onStart();
          } finally {
            setBusy(false);
          }
        }}
      >
        はじめる
      </button>
    </div>
  );
}
