import { useCallback, useEffect, useRef } from 'react';
import { TIME_OF_DAY_LABEL, WEATHER_LABEL } from '../core/environment';
import { elapsedParts, formatCountdown, nextGrowthAt, timeOfDayFromHour } from '../core/time';
import type { ControllerState } from '../engine/gameController';
import { CreatureView, type CreatureViewHandle } from './CreatureView';
import { DevPanel } from './DevPanel';
import { useNow, useSettings } from './hooks';
import type { AppServices } from './services';

interface Props {
  services: AppServices;
  state: ControllerState;
  onOpen: (screen: 'history' | 'settings') => void;
  hidden: boolean;
}

export function MainScreen({ services, state, onOpen, hidden }: Props) {
  const { controller, settings: settingsStore, clock, devClock } = services;
  const settings = useSettings(settingsStore);
  const nowFn = useCallback(() => clock.now(), [clock]);
  const now = useNow(nowFn, 1000);
  const view = useRef<CreatureViewHandle>(null);

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

  const game = state.game!;
  const el = elapsedParts(game.startedAt, now);
  const next = nextGrowthAt(game.startedAt, game.lastProcessedGrowthIndex);
  const remaining = next - now;
  const tod = timeOfDayFromHour(new Date(now).getHours());
  const weather = state.weatherLog?.weather ?? 'unknown';

  return (
    <div className="main-screen" aria-hidden={hidden}>
      <CreatureView ref={view} controller={controller} settingsStore={settingsStore} settings={settings} />

      <header className="hud-top">
        <div>
          <div className="brand">DOT LIFE</div>
          <div className="age" data-testid="elapsed">
            {el.days}日 {el.hours}時間 経過
          </div>
        </div>
        <nav className="hud-actions">
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
        <div className="count">
          <span data-testid="dot-count">{state.pixelCount.toLocaleString()}</span>
          <small> dots</small>
        </div>
        <dl className="stats">
          <div>
            <dt>次の成長まで</dt>
            <dd data-testid="countdown">{formatCountdown(remaining)}</dd>
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

      {devClock && <DevPanel devClock={devClock} onAdvanced={() => void controller.checkGrowth()} />}
    </div>
  );
}
