import { useState } from 'react';
import type { CreatureStyle } from '../core/genome';

type Choice = CreatureStyle | 'random';

const CHOICES: { value: Choice; label: string; hint: string }[] = [
  { value: 'cute', label: 'かわいい', hint: 'まるい体・パステル・つぶらな目' },
  { value: 'cool', label: 'かっこかわいい', hint: 'とがった耳・深い色・光る目' },
  { value: 'ghost', label: 'おばけ（かわいい）', hint: 'ふわふわの裾・白い体・ほっぺ' },
  { value: 'ghostCool', label: 'おばけ（かっこかわいい）', hint: '夜色の体・光る目・小さな牙' },
  { value: 'random', label: 'おまかせ', hint: 'どのタイプになるかは生まれてから' },
];

export function StartScreen({ onStart }: { onStart: (style: Choice) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
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
      <p className="muted small">タイプは「なりやすさ」の傾向です。形や顔は育ってみるまでわかりません。</p>
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
    </div>
  );
}
