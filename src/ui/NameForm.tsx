import { useEffect, useState } from 'react';
import { NAME_MAX_LENGTH } from '../core/constants';

interface Props {
  /** Initial value (e.g. a suggested name). */
  initial: string | Promise<string>;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
}

/** Name entry used when saving to / renaming in the collection. Names may repeat. */
export function NameForm({ initial, submitLabel, onSubmit, onCancel, cancelLabel = 'キャンセル' }: Props) {
  const [name, setName] = useState(typeof initial === 'string' ? initial : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof initial !== 'string') void initial.then((v) => setName((cur) => cur || v));
  }, [initial]);

  return (
    <form
      className="name-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onSubmit(name);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label htmlFor="creature-name" className="small muted">
        名前（{NAME_MAX_LENGTH}文字まで・ほかの子と同じ名前でも大丈夫）
      </label>
      <input
        id="creature-name"
        data-testid="name-input"
        className="text-input"
        value={name}
        maxLength={NAME_MAX_LENGTH * 2}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
      />
      {error && (
        <p className="notice err" role="alert" data-testid="name-error">
          {error}
        </p>
      )}
      <div className="name-actions">
        <button type="submit" className="btn primary" data-testid="name-submit" disabled={busy}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  );
}
