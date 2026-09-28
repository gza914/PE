import type { EndTitle } from '../sim/state';
import { useGame } from './store';
import { charLabel } from './util';

const TITLE: Record<EndTitle, { name: string; text: string }> = {
  el_patron: { name: 'El Patrón', text: 'You came out of the war on top.' },
  kingmaker: { name: 'Kingmaker', text: 'You joined late, and your side won because of it.' },
  survivor: { name: 'Survivor', text: 'You kept your plazas and your freedom.' },
  pawn: { name: 'Pawn', text: 'You lost ground, but you lived.' },
  corrido: { name: 'Corrido', text: 'You died, but they will sing about you.' },
  extradited: { name: 'Extradited', text: 'The state took you off the board.' },
};

const REASON = {
  faction_collapse: 'A faction collapsed',
  territorial_defeat: 'Territorial defeat',
  negotiated_truce: 'A negotiated truce',
  time_cap: 'The war ran its course',
  player_eliminated: 'Your organization fell apart',
} as const;

export function EndScreen() {
  const { content, game } = useGame();
  if (!game?.ended) return null;
  const e = game.ended;
  const winner = content.factions.find((f) => f.id === e.winner);
  const title = e.title ? TITLE[e.title] : null;
  const s = e.score;
  const rows: [string, number, number][] = s
    ? [
        ['Territory', s.territory, content.tuning.endings.scoreWeights.territory],
        ['Wealth', s.wealth, content.tuning.endings.scoreWeights.wealth],
        ['Standing', s.standing, content.tuning.endings.scoreWeights.standing],
        ['Reputation', s.reputation, content.tuning.endings.scoreWeights.reputation],
        ['Force', s.force, content.tuning.endings.scoreWeights.force],
      ]
    : [];
  return (
    <div className="endscreen" role="dialog" aria-label="The war is over">
      <div className="endcard">
        <p className="muted">
          {REASON[e.reason]} · day {Math.floor(e.hour / 24)}
          {winner ? ` · the ${winner.name} won` : ''}
        </p>
        {title && <h1>{title.name}</h1>}
        <p>
          {charLabel(game, game.playerId)}: {title?.text}
        </p>
        {s && (
          <>
            <p className="bigcash mono">Score {Math.round(s.total)}</p>
            <table className="mono small">
              <tbody>
                {rows.map(([k, v, w]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>×{v.toFixed(2)} vs your start</td>
                    <td className="muted">{Math.round(w * 100)}%</td>
                  </tr>
                ))}
                <tr>
                  <td>Fate</td>
                  <td>×{s.fate.toFixed(2)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            <p className="muted small">100 means you ended exactly where you started.</p>
          </>
        )}
        <button onClick={() => window.location.reload()}>New game</button>
      </div>
    </div>
  );
}
