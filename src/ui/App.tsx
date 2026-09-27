import { useEffect } from 'react';
import { CharacterSelect } from './CharacterSelect';
import { DetailPanel } from './DetailPanel';
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePause();
      } else if (/^[1-5]$/.test(e.key)) setSpeed(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, setSpeed]);
}

export function App() {
  const game = useGame((s) => s.game);
  const view = useGame((s) => s.view);
  useGameLoop();
  useHotkeys();

  if (!game) return <CharacterSelect />;

  return (
    <div className="app">
      <TopBar />
      <aside className="panel left">
        <DetailPanel />
      </aside>
      <main className="map">{view === 'state' ? <StateMap /> : <CuliacanMap />}</main>
      <aside className="panel right">
        <Feed />
      </aside>
    </div>
  );
}
