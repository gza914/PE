import { formatDateTime } from '../sim/clock';
import { cashOf } from '../sim/money';
import { payrollDue } from '../sim/systems/economy';
import { tierOf } from '../sim/systems/stateForces';
import { DecisionsButton } from './EventPopup';
import { useGame, type Overlay } from './store';
import { charLabel } from './util';

export function TopBar() {
  const { content, game, speed, setSpeed, view, set, overlay, revealAll, autoPause } = useGame();
  if (!game) return null;
  const player = game.characters[game.playerId]!;
  const faction = player.faction ? game.factions[player.faction] : null;
  const factionName = content.factions.find((f) => f.id === player.faction)?.name;
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
      <span>{charLabel(game, player.id)}</span>
      <span
        className={`mono${cashOf(game, player.id) < payrollDue(game, content, player.id) || player.missedPayrollWeeks > 0 ? ' error' : ''}`}
        title={`Payroll due Sunday: $${Math.round(payrollDue(game, content, player.id)).toLocaleString()}`}
      >
        ${Math.round(cashOf(game, player.id)).toLocaleString()}
      </span>
      {faction ? (
        <span className="mono" title={factionName}>
          Supply {Math.round(faction.supply)} · Exh. {Math.round(faction.exhaustion)}
        </span>
      ) : (
        <span className="muted">Neutral</span>
      )}
      {calentura !== undefined && (
        <span className="mono" title={`The State at home: ${tierOf(content, calentura)}`}>
          Calentura {Math.round(calentura)}
        </span>
      )}
      {player.stateIntel >= 70 && (
        <span className="mono warn" title="At 100 the State launches a capture operation">
          State intel {Math.round(player.stateIntel)}
        </span>
      )}
      <DecisionsButton />
      {home && <span className={`warstate ${game.regions[home.region]?.warState}`}>{game.regions[home.region]?.warState}</span>}
      {Object.values(game.battles).some((b) => b.endedAt === null && [b.attackers.network, b.defenders.network].includes(player.faction ?? player.id)) && (
        <span className="warstate offensive">⚔ fighting</span>
      )}
      <span className="spacer" />
      <select value={overlay} onChange={(e) => set({ overlay: e.target.value as Overlay })} title="Map overlay">
        <option value="none">No overlay</option>
        <option value="halcones">Halcón coverage</option>
        <option value="calentura">Calentura</option>
        <option value="income">Businesses</option>
        <option value="war">War state</option>
      </select>
      <label className="small" title="Pause automatically on critical reports">
        <input type="checkbox" checked={autoPause} onChange={(e) => set({ autoPause: e.target.checked })} /> Auto-pause
      </label>
      <label className="small" title="Debug: show every crew">
        <input type="checkbox" checked={revealAll} onChange={(e) => set({ revealAll: e.target.checked })} /> Lift fog
      </label>
      <button onClick={() => set({ view: view === 'state' ? 'culiacan' : 'state', plan: null })}>{view === 'state' ? 'Culiacán' : 'State'}</button>
      {game.ended && <strong>War over: {game.ended.reason.replace('_', ' ')}</strong>}
    </header>
  );
}
