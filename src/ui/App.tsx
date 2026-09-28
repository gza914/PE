import { useEffect } from 'react';
import { CharacterSelect } from './CharacterSelect';
import { DetailPanel } from './DetailPanel';
import { EndScreen } from './EndScreen';
import { ErrorBoundary } from './ErrorBoundary';
import { EventPopup } from './EventPopup';
import { Feed } from './Feed';
import { CuliacanMap } from './map/CuliacanMap';
import { StateMap } from './map/StateMap';
import { useGame } from './store';
import { TopBar } from './TopBar';

function useGameLoop() {
  const speed = useGame((s) => s.speed);
  const msPerHour = useGame((s) => s.content.tuning.clock.realMsPerHourBySpeed);
  const step = useGame((s) => s.step);
  useEffect(() => {
    if (speed === 0) return;
    const id = setInterval(step, msPerHour[speed - 1]);
    return () => clearInterval(id);
  }, [speed, msPerHour, step]);
}

function useHotkeys() {
  const togglePause = useGame((s) => s.togglePause);
  const setSpeed = useGame((s) => s.setSpeed);
  const set = useGame((s) => s.set);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') set({ plan: null });
      else if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (/^[1-5]$/.test(e.key)) setSpeed(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, setSpeed, set]);
}

export function App() {
  const game = useGame((s) => s.game);
  const view = useGame((s) => s.view);
  const select = useGame((s) => s.select);
  const set = useGame((s) => s.set);
  useGameLoop();
  useHotkeys();

  if (!game) return <CharacterSelect />;

  return (
    <div className="app">
      <ErrorBoundary label="top bar">
        <TopBar />
      </ErrorBoundary>
      <aside className="panel left">
        <ErrorBoundary label="side panel" onReset={() => select(null)}>
          <DetailPanel />
        </ErrorBoundary>
      </aside>
      <main className="map">
        <ErrorBoundary label="map" onReset={() => set({ plan: null })}>
          {view === 'state' ? <StateMap /> : <CuliacanMap />}
        </ErrorBoundary>
      </main>
      <aside className="panel right">
        <ErrorBoundary label="report panel">
          <Feed />
        </ErrorBoundary>
      </aside>
      <ErrorBoundary label="event window">
        <EventPopup />
      </ErrorBoundary>
      <ErrorBoundary label="end screen">
        <EndScreen />
      </ErrorBoundary>
    </div>
  );
}
