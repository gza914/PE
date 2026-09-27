import { formatDateTime } from '../sim/clock';
import { useGame } from './store';

export function TopBar() {
  const { content, game, speed, setSpeed, view, setView } = useGame();
  if (!game) return null;
  const player = game.characters[game.playerId]!;
  const faction = player.faction ? game.factions[player.faction] : null;
  const home = player.homePlaza ? content.nodes.find((n) => n.id === player.homePlaza) : undefined;
  const calentura = home ? game.regions[home.region]?.calentura : undefined;

  return (
    <header className="topbar">
      <span className="mono">{formatDateTime(game.hour, content.tuning)}</span>
      <span className="speeds">
        {[0, 1, 2, 3, 4, 5].map((s) => (
          <button key={s} className={s === speed ? 'on' : ''} onClick={() => setSpeed(s)} title={s === 0 ? 'Pause (Space)' : `Speed ${s}`}>
            {s === 0 ? '❚❚' : s}
          </button>
        ))}
      </span>
      <span>{player.name}</span>
      <span className="mono">${player.cash.toLocaleString()}</span>
      {faction ? (
        <span className="mono">
          Supply {Math.round(faction.supply)} · Exhaustion {Math.round(faction.exhaustion)}
        </span>
      ) : (
        <span className="muted">Neutral</span>
      )}
      {calentura !== undefined && <span className="mono">Calentura {Math.round(calentura)}</span>}
      <span className="spacer" />
      <button onClick={() => setView(view === 'state' ? 'culiacan' : 'state')}>{view === 'state' ? 'Culiacán view' : 'State view'}</button>
      {game.ended && <strong>War over: {game.ended.reason.replace('_', ' ')}</strong>}
    </header>
  );
}
