import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GEMS, GEM_ORDER } from '../core/gems';
import { TIME_OF_DAY_LABEL, WEATHER_LABEL } from '../core/environment';
import { elapsedParts, formatCountdown, timeOfDayFromHour } from '../core/time';
import { activeBoost, completeDays, dotsPerDay, nextSlotDueAt } from '../core/schedule';
import type { ControllerState } from '../engine/gameController';
import { CreatureView, type CreatureViewHandle } from './CreatureView';
import { CompletionDialog } from './CompletionDialog';
import { ItemSheet } from './ItemSheet';
import { BoostSheet } from './BoostSheet';
import { NewCreatureSheet } from './NewCreatureSheet';
import { DevPanel } from './DevPanel';
import { useNow, useSettings } from './hooks';
import type { AppServices } from './services';

interface Props {
  services: AppServices;
  state: ControllerState;
  onOpen: (screen: 'history' | 'settings' | 'collection' | 'battle' | 'shop') => void;
  hidden: boolean;
}

export function MainScreen({ services, state, onOpen, hidden }: Props) {
  const { controller, settings: settingsStore, clock, devClock } = services;
  const settings = useSettings(settingsStore);
  const nowFn = useCallback(() => clock.now(), [clock]);
  const now = useNow(nowFn, 1000);
  const view = useRef<CreatureViewHandle>(null);
  const [sheet, setSheet] = useState<'food' | 'toy' | 'boost' | 'new' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };

  // The 1 s timer only drives the display and *asks* whether growth is due;
  // what is due is computed from the stored start time and the current time.
  useEffect(() => {
    if (controller.isGrowthDue(now)) void controller.checkGrowth();
    controller.maybeRefreshEnvironment();
  }, [controller, now]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void controller.checkGrowth();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [controller]);

  // precious dots: a count in the HUD, and a word when new ones are born
  const gemCount = useMemo(() => controller.pixels.reduce((n, p) => n + (p.gem ? 1 : 0), 0), [controller, state.pixelCount]);
  useEffect(
    () =>
      controller.onPixels(({ pixels, reason }) => {
        if (reason === 'initial') return;
        const born = pixels.filter((p) => p.gem);
        if (!born.length) return;
        const top = GEM_ORDER.find((k) => born.some((p) => p.gem === k))!;
        showToast(born.length === 1 ? `✨ ${GEMS[top].icon} ${GEMS[top].name}のドットが生まれた！` : `✨ きらきらドットが${born.length}つ生まれていたよ（${GEMS[top].icon} ${GEMS[top].name}など）`);
      }),
    [controller],
  );

  const game = state.game!;
  const el = elapsedParts(game.startedAt, now);
  const next = nextSlotDueAt(game);
  const remaining = next - now;
  const boost = state.completion === 'complete' ? null : activeBoost(game, now);
  const tod = timeOfDayFromHour(new Date(now).getHours());
  const weather = state.weatherLog?.weather ?? 'unknown';

  return (
    <div className={`main-screen${state.completion !== 'growing' ? ' has-new-btn' : ''}`} aria-hidden={hidden}>
      <CreatureView ref={view} controller={controller} settingsStore={settingsStore} settings={settings} bottomInset={state.completion === 'complete' ? 300 : state.completion === 'continuing' ? 60 : 0} />

      <header className="hud-top">
        <div>
          <div className="brand">DOT LIFE</div>
          <div className="age" data-testid="elapsed">
            {el.days}日 {el.hours}時間 経過
          </div>
          {gemCount > 0 && (
            <div className="hud-gems" data-testid="hud-gems">
              ✨ きらきら {gemCount}
            </div>
          )}
          {state.completion !== 'growing' && <div className="done-pill" data-testid="complete-badge">完成</div>}
        </div>
        <nav className="hud-actions">
          <button className="icon-btn" data-testid="open-shop" onClick={() => onOpen('shop')} aria-label="ショップ">
            <span aria-hidden>🪙</span>
            <small data-testid="hud-coins">{state.coins.toLocaleString()}</small>
          </button>
          <button className="icon-btn" data-testid="open-collection" onClick={() => onOpen('collection')} aria-label="図鑑">
            <span aria-hidden>▦</span>
            <small>図鑑</small>
          </button>
          <button className="icon-btn" data-testid="open-battle" onClick={() => onOpen('battle')} aria-label="対決">
            <span aria-hidden>⚔</span>
            <small>対決</small>
          </button>
          <button className="icon-btn" data-testid="open-history" onClick={() => onOpen('history')} aria-label="成長履歴">
            <span aria-hidden>☰</span>
            <small>履歴</small>
          </button>
          <button className="icon-btn" data-testid="open-settings" onClick={() => onOpen('settings')} aria-label="設定">
            <span aria-hidden>⚙</span>
            <small>設定</small>
          </button>
        </nav>
      </header>

      {state.catchUp && (
        <div className="banner" role="status" data-testid="catchup">
          眠っていた間の成長を反映中… {state.catchUp.done.toLocaleString()} / {state.catchUp.total.toLocaleString()}
        </div>
      )}
      {state.clockWarning && (
        <div className="banner warn" role="status" data-testid="clock-warning">
          端末の時計が以前より戻っています。時刻が追いつくまで成長は待機します（データは変更されません）。
        </div>
      )}
      {state.error && <div className="banner warn" role="alert">{state.error}</div>}

      <div className="zoom-controls">
        <button className="icon-btn round" data-testid="zoom-in" aria-label="拡大" onClick={() => view.current?.zoom(1.4)}>＋</button>
        <button className="icon-btn round" data-testid="zoom-out" aria-label="縮小" onClick={() => view.current?.zoom(1 / 1.4)}>－</button>
        <button className="icon-btn round" data-testid="zoom-fit" aria-label="全体を表示" onClick={() => view.current?.reset()}>◎</button>
      </div>

      <footer className="hud-bottom">
        {boost && (
          <div className="boost-pill" data-testid="boost-status">
            ⏩ ペースアップ中（6倍） のこり {formatCountdown(boost.endsAt - now)}
          </div>
        )}
        {state.completion !== 'growing' && (
          <button className="btn primary wide new-creature-btn" data-testid="new-creature-button" onClick={() => setSheet('new')}>
            🌱 新しい子を育てる
          </button>
        )}
        <div className="count-row">
          <div className="count">
            <span data-testid="dot-count">{state.pixelCount.toLocaleString()}</span>
            <small> dots</small>
          </div>
          <div className="care-actions">
            <button className="care-btn" data-testid="open-food" onClick={() => setSheet('food')} disabled={state.completion === 'complete'}>
              <span aria-hidden>🍽</span> ごはん
            </button>
            <button className="care-btn" data-testid="open-toy" onClick={() => setSheet('toy')} disabled={state.completion === 'complete'}>
              <span aria-hidden>🎈</span> あそぶ
            </button>
            <button className="care-btn" data-testid="open-boost" onClick={() => setSheet('boost')} disabled={state.completion === 'complete'}>
              <span aria-hidden>⏩</span> 時短
            </button>
          </div>
        </div>
        <dl className="stats">
          <div>
            <dt>次の成長まで</dt>
            <dd data-testid="countdown">{state.completion === 'complete' ? '完成' : formatCountdown(remaining)}</dd>
          </div>
          <div>
            <dt>時間帯</dt>
            <dd data-testid="time-of-day">{TIME_OF_DAY_LABEL[tod]}</dd>
          </div>
          <div>
            <dt>天気</dt>
            <dd data-testid="weather">{weather === 'unknown' ? (settings.locationEnabled ? '取得中/不明' : '—') : WEATHER_LABEL[weather]}</dd>
          </div>
        </dl>
      </footer>

      {toast && (
        <div className="toast" role="status" data-testid="item-toast">
          {toast}
        </div>
      )}

      {sheet === 'new' && (
        <NewCreatureSheet
          count={state.pixelCount}
          days={completeDays(game)}
          suggestName={() => controller.suggestName()}
          onSave={(name) => controller.retireToCollection(name)}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === 'boost' && (
        <BoostSheet
          inventory={state.inventory}
          perDay={dotsPerDay(game)}
          onClose={() => setSheet(null)}
          onOpenShop={() => {
            setSheet(null);
            onOpen('shop');
          }}
          onUse={async (id) => {
            try {
              const { boost: b, ms } = await controller.useBoost(id);
              setSheet(null);
              const days = ms / 86_400_000;
              showToast(`${b.icon} ${b.name}を使った！ ${days >= 1 && Number.isInteger(days) ? `${days}日` : `${Math.round(ms / 3_600_000)}時間`}ぶん、ペースアップ！`);
            } catch (e) {
              showToast((e as Error).message);
            }
          }}
        />
      )}

      {(sheet === 'food' || sheet === 'toy') && (
        <ItemSheet
          kind={sheet}
          inventory={state.inventory}
          onClose={() => setSheet(null)}
          onUse={async (id) => {
            try {
              const ev = await controller.useItem(id);
              setSheet(null);
              showToast(`${ev.item.icon} ${ev.item.name}${ev.item.kind === 'food' ? 'をあげた！' : 'であそんだ！'} 次の成長が${Math.round(ev.ms / 60_000)}分はやくなったよ`);
            } catch (e) {
              showToast((e as Error).message);
            }
          }}
        />
      )}

      {state.completion === 'complete' && !hidden && (
        <CompletionDialog
          count={state.pixelCount}
          days={completeDays(game)}
          gift={state.game?.gift ?? null}
          suggestName={() => controller.suggestName()}
          onSave={(name) => controller.retireToCollection(name)}
          onContinue={() => controller.continueGrowing()}
        />
      )}

      {devClock && <DevPanel devClock={devClock} onAdvanced={() => void controller.checkGrowth()} />}
    </div>
  );
}
