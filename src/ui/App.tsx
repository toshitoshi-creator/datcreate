import { useEffect, useState } from 'react';
import { BattleScreen } from './BattleScreen';
import { CollectionScreen } from './CollectionScreen';
import { HistoryScreen } from './HistoryScreen';
import { MainScreen } from './MainScreen';
import { SettingsScreen } from './SettingsScreen';
import { StartScreen } from './StartScreen';
import { useControllerState } from './hooks';
import { getServices, type AppServices } from './services';

export function App() {
  const [services, setServices] = useState<AppServices | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    getServices()
      .then((s) => {
        setServices(s);
        void s.controller.init();
        // Ask the browser not to evict our long-lived save data.
        void navigator.storage?.persist?.().catch(() => undefined);
      })
      .catch((e: Error) => setFatal(`保存領域(IndexedDB)を開けませんでした: ${e.message}`));
  }, []);

  if (fatal) return <ErrorView message={fatal} />;
  if (!services) return <Splash />;
  return <Game services={services} />;
}

type Screen = 'main' | 'history' | 'settings' | 'collection' | 'battle';

function Game({ services }: { services: AppServices }) {
  const state = useControllerState(services.controller);
  const [screen, setScreen] = useState<Screen>('main');

  if (state.status === 'loading') return <Splash />;
  if (state.status === 'error') return <ErrorView message={state.error ?? '不明なエラー'} />;
  if (state.status === 'no-game') {
    if (screen === 'collection') return <CollectionScreen controller={services.controller} onClose={() => setScreen('main')} />;
    if (screen === 'battle') return <CollectionScreen controller={services.controller} forBattle onClose={() => setScreen('main')} />;
    return (
      <StartScreen
        controller={services.controller}
        onStart={async (style) => {
          await services.controller.startNewGame(style);
          setScreen('main');
        }}
        onOpenCollection={() => setScreen('collection')}
        onOpenBattle={() => setScreen('battle')}
      />
    );
  }
  return (
    <>
      <MainScreen services={services} state={state} onOpen={setScreen} hidden={screen !== 'main'} />
      {screen === 'history' && <HistoryScreen services={services} state={state} onClose={() => setScreen('main')} />}
      {screen === 'settings' && <SettingsScreen services={services} state={state} onClose={() => setScreen('main')} />}
      {screen === 'collection' && <CollectionScreen controller={services.controller} onClose={() => setScreen('main')} />}
      {screen === 'battle' && <BattleScreen controller={services.controller} onClose={() => setScreen('main')} />}
    </>
  );
}

function Splash() {
  return (
    <div className="center-screen" aria-busy="true">
      <div className="splash-dot" />
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="center-screen error-view" role="alert">
      <h1>問題が発生しました</h1>
      <p>{message}</p>
      <p className="muted">保存データは変更していません。ページを再読み込みしてください。</p>
      <button className="btn" onClick={() => location.reload()}>再読み込み</button>
    </div>
  );
}
