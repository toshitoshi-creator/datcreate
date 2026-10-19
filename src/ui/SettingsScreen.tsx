import { useRef, useState, type ReactNode } from 'react';
import { WEATHER_LABEL } from '../core/environment';
import type { FetchStatus } from '../core/types';
import type { ControllerState } from '../engine/gameController';
import { useSettings } from './hooks';
import { NameForm } from './NameForm';
import type { AppServices } from './services';

const STATUS_LABEL: Record<FetchStatus, string> = {
  ok: '取得成功',
  error: '取得失敗（直近の値または中立値を使用）',
  timeout: 'タイムアウト（直近の値または中立値を使用）',
  disabled: '位置情報オフのため天気は使用していません',
  denied: '位置情報が許可されませんでした',
  unavailable: 'この端末では位置情報を利用できません',
};

const fmt = new Intl.DateTimeFormat('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

interface Props {
  services: AppServices;
  state: ControllerState;
  onClose: () => void;
}

export function SettingsScreen({ services, state, onClose }: Props) {
  const { controller, settings: store } = services;
  const s = useSettings(store);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [retireSuggestion, setRetireSuggestion] = useState<Promise<string> | null>(null);
  const [pendingImport, setPendingImport] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const exportSave = () =>
    run(async () => {
      const text = await controller.exportSaveText();
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      a.href = url;
      a.download = `dot-life-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMsg({ kind: 'ok', text: 'セーブデータを書き出しました。' });
    });

  const env = state.latestEnv;
  const weather = state.weatherLog;

  return (
    <div className="sheet" role="dialog" aria-label="設定" data-testid="settings-screen">
      <header className="sheet-header">
        <button className="text-btn" onClick={onClose} data-testid="close-settings">← 戻る</button>
        <h2>設定</h2>
        <span />
      </header>
      <div className="sheet-body">
        {state.completion !== 'growing' && (
          <Section title="この個体">
            <Row label="図鑑にしまう" hint="名前をつけて今の姿のまま図鑑に保存し、新しい子を育てます。">
              <button className="btn small" data-testid="retire-from-settings" disabled={busy} onClick={() => { setRetireSuggestion(controller.suggestName()); setConfirmRetire(true); }}>
                新しい子を育てる
              </button>
            </Row>
          </Section>
        )}

        <Section title="環境">
          <Row label="位置情報を使って天気を反映" hint="座標は保存・表示しません。天気の取得にだけ使います。">
            <Toggle
              testId="toggle-location"
              checked={s.locationEnabled}
              onChange={(on) => run(async () => {
                const status = await controller.setLocationEnabled(on);
                if (on && status && status !== 'ok') setMsg({ kind: 'err', text: STATUS_LABEL[status] + '。ゲームはそのまま続けられます。' });
              })}
            />
          </Row>
          <div className="env-status" data-testid="weather-status">
            <div>天気: {weather ? `${WEATHER_LABEL[weather.weather]}${weather.temperatureC !== null ? ` / ${Math.round(weather.temperatureC)}℃` : ''}（${fmt.format(weather.capturedAt)} 取得）` : '未取得（中立値で成長します）'}</div>
            <div className="muted small">状態: {env ? STATUS_LABEL[env.fetchStatus] : state.locationStatus ? STATUS_LABEL[state.locationStatus] : '—'}</div>
          </div>
          <Row label={`環境の影響 ${Math.round(s.environmentInfluence * 100)}%`} hint="時間帯や天気が、これから生まれるドットの色と伸び方に与える影響の強さ。">
            <input type="range" min={0} max={1} step={0.05} value={s.environmentInfluence} onChange={(e) => store.update({ environmentInfluence: Number(e.target.value) })} />
          </Row>
          <Row label={`生き物らしさの傾向 ${Math.round(s.organicShapeBias * 100)}%`} hint="目・口・手足のような構造が生まれやすくなる弱い傾向。既存のドットは変わりません。">
            <input type="range" min={0} max={1} step={0.05} value={s.organicShapeBias} onChange={(e) => store.update({ organicShapeBias: Number(e.target.value) })} />
          </Row>
        </Section>

        {services.notifications && (
          <Section title="通知">
            <Row label="完成したらお知らせ" hint="15日たって完成するとき、アプリを閉じていても通知します。ごはん・あそぶで早まった分も反映されます。">
              <Toggle testId="toggle-notify" checked={s.notifyOnComplete} onChange={(on) => store.update({ notifyOnComplete: on })} />
            </Row>
          </Section>
        )}
        <Section title="表示">
          <Row label="アニメーション">
            <Toggle testId="toggle-animation" checked={s.animationEnabled} onChange={(on) => store.update({ animationEnabled: on })} />
          </Row>
          <Row label="輪郭線" hint="体のまわりにドット絵風の縁取りを表示します（表示のみ。データは変わりません）。">
            <Toggle testId="toggle-outline" checked={s.outlineEnabled} onChange={(on) => store.update({ outlineEnabled: on })} />
          </Row>
          <Row label="サウンド" hint="観察中に新しいドットが生まれたとき、小さな音を鳴らします。">
            <Toggle testId="toggle-sound" checked={s.soundEnabled} onChange={(on) => store.update({ soundEnabled: on })} />
          </Row>
          <Row label="表示倍率">
            <button className="btn small" data-testid="reset-zoom" onClick={() => { store.update({ zoomLevel: null, viewCenterX: null, viewCenterY: null }); setMsg({ kind: 'ok', text: '表示倍率をリセットしました。' }); }}>
              リセット
            </button>
          </Row>
        </Section>

        <Section title="セーブデータ">
          <div className="btn-row">
            <button className="btn" data-testid="export" disabled={busy} onClick={exportSave}>書き出し（JSON）</button>
            <button className="btn" data-testid="import" disabled={busy} onClick={() => fileRef.current?.click()}>読み込み</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              data-testid="import-file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) setPendingImport(await f.text());
              }}
            />
          </div>
          <p className="muted small">読み込み時は形式・必須項目・バージョンを検証し、不正なデータでは現在のセーブを変更しません。</p>
        </Section>

        <Section title="ゲームのリセット">
          <button className="btn danger" data-testid="reset-game" disabled={busy} onClick={() => setConfirmReset(true)}>
            個体を消去して最初から
          </button>
        </Section>

        {msg && (
          <p className={msg.kind === 'ok' ? 'notice ok' : 'notice err'} role="status" data-testid="settings-message">
            {msg.text}
          </p>
        )}
      </div>

      {confirmReset && (
        <ResetDialog
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => run(async () => {
            setConfirmReset(false);
            await controller.resetGame();
            onClose();
          })}
        />
      )}
      {confirmRetire && (
        <div className="modal-backdrop" role="dialog" aria-label="図鑑にしまう">
          <div className="modal">
            <h3>名前をつけて図鑑にしまう</h3>
            <p>この子は今の姿のまま図鑑に保存され、成長はそこで止まります。そのあと新しい子を育てます。</p>
            <NameForm
              initial={retireSuggestion ?? ''}
              submitLabel="図鑑に保存して、新しい子を育てる"
              onCancel={() => setConfirmRetire(false)}
              onSubmit={async (name) => {
                await controller.retireToCollection(name);
                setConfirmRetire(false);
                onClose();
              }}
            />
          </div>
        </div>
      )}
      {pendingImport !== null && (
        <Confirm
          title="セーブデータを読み込みますか？"
          body="現在の個体は、読み込んだデータで置き換えられます。必要なら先に書き出してください。"
          confirmLabel="読み込む"
          testId="confirm-import"
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            const text = pendingImport;
            setPendingImport(null);
            void run(async () => {
              await controller.importSaveText(text);
              setMsg({ kind: 'ok', text: 'セーブデータを読み込みました。' });
            });
          }}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, testId }: { checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <button role="switch" aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} data-testid={testId} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function Confirm(props: { title: string; body: string; confirmLabel: string; testId: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="alertdialog" aria-label={props.title}>
      <div className="modal">
        <h3>{props.title}</h3>
        <p>{props.body}</p>
        <div className="btn-row end">
          <button className="btn" onClick={props.onCancel}>キャンセル</button>
          <button className="btn primary" data-testid={props.testId} onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function ResetDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const [understood, setUnderstood] = useState(false);
  return (
    <div className="modal-backdrop" role="alertdialog" aria-label="ゲームのリセット">
      <div className="modal">
        <h3>本当にリセットしますか？</h3>
        <p>この個体のドット・成長履歴・記録はすべて削除され、元に戻せません。残したい場合は先にセーブデータを書き出してください。</p>
        <label className="check">
          <input type="checkbox" data-testid="reset-understood" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          元に戻せないことを理解しました
        </label>
        <div className="btn-row end">
          <button className="btn" onClick={onCancel}>キャンセル</button>
          <button className="btn danger" data-testid="confirm-reset" disabled={!understood} onClick={onConfirm}>リセットする</button>
        </div>
      </div>
    </div>
  );
}
