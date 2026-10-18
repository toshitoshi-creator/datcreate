import { useEffect, useState } from 'react';
import type { GameController } from '../engine/gameController';

type Choice = 'cute' | 'cool' | 'random';

const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'cute', label: 'かわいい', hint: 'やさしい雰囲気の子が生まれやすい' },
  { value: 'cool', label: 'かっこいい', hint: 'クールな雰囲気の子が生まれやすい' },
  { value: 'random', label: 'ランダム', hint: 'どちらになるかもお楽しみ' },
];

interface Props {
  controller: GameController;
  onStart: (style: Choice) => Promise<void>;
  onOpenCollection: () => void;
  onOpenBattle: () => void;
}

export function StartScreen({ controller, onStart, onOpenCollection, onOpenBattle }: Props) {
  const [busy, setBusy] = useState(false);
  const [collected, setCollected] = useState(0);
  useEffect(() => {
    controller.listCollection().then((l) => setCollected(l.length)).catch(() => setCollected(0));
  }, [controller]);
  const [choice, setChoice] = useState<Choice>('cute');
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
      <div className="style-picker" role="radiogroup" aria-label="タイプ">
        {CHOICES.map((c) => (
          <button
            key={c.value}
            role="radio"
            aria-checked={choice === c.value}
            className={`style-option ${choice === c.value ? 'selected' : ''}`}
            data-testid={`style-${c.value}`}
            onClick={() => setChoice(c.value)}
          >
            <span>{c.label}</span>
            <small>{c.hint}</small>
          </button>
        ))}
      </div>
      <p className="muted small">どんな子が生まれるかは、育ててみてからのお楽しみ。</p>
      <button
        className="btn primary"
        data-testid="start-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onStart(choice);
          } finally {
            setBusy(false);
          }
        }}
      >
        はじめる
      </button>
      {collected > 0 && (
        <div className="start-links">
          <button className="btn" data-testid="start-open-collection" onClick={onOpenCollection}>
            ▦ 図鑑を見る（{collected}）
          </button>
          <button className="btn" data-testid="start-open-battle" onClick={onOpenBattle}>
            ⚔ 対決
          </button>
        </div>
      )}
    </div>
  );
}
