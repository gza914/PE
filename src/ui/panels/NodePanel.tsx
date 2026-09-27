import { lastSeen } from '../../sim/knowledge';
import { crewNetwork, networkOf } from '../../sim/network';
import { useGame } from '../store';
import { charLabel, crewLabel, playerNetwork } from '../util';

export function NodePanel({ id }: { id: string }) {
  const { content, game, select, enqueue, revealAll } = useGame();
  if (!game) return null;
  const def = content.nodes.find((n) => n.id === id)!;
  const p = game.nodes[id]!;
  const net = playerNetwork(game);
  const owner = p.owner ? game.characters[p.owner] : null;
  const ours = p.owner !== null && networkOf(game, p.owner) === net;
  const mine = p.owner === game.playerId;
  const crews = Object.values(game.crews).filter(
    (c) => c.location.kind === 'node' && c.location.node === id && (revealAll || crewNetwork(game, c) === net),
  );
  const seen = revealAll ? [] : lastSeen(game, content, net).filter((s) => s.where.kind === 'node' && s.where.node === id);
  const region = content.regions.find((r) => r.id === def.region);
  const known = (v: number | string) => (ours || revealAll ? v : '?');

  return (
    <div>
      <h2>{def.name}</h2>
      <p className="muted">
        {def.type.replace('_', ' ')} · {region?.name}
      </p>
      <dl>
        <dt>Owner</dt>
        <dd>{owner ? charLabel(game, owner.id) : def.hasSubmap ? 'Contested (see Culiacán view)' : 'None'}</dd>
        <dt>Fortification</dt>
        <dd>{p.fortification} / 3</dd>
        <dt>Support</dt>
        <dd>{known(p.support)}</dd>
        <dt>Halcones</dt>
        <dd>{known(p.halconCoverage)}</dd>
        <dt>Businesses</dt>
        <dd>{p.businesses}</dd>
        <dt>Labs</dt>
        <dd>{known(p.labs)}</dd>
        <dt>Military</dt>
        <dd>{p.militaryPresence} / 3</dd>
        <dt>Calentura</dt>
        <dd>{Math.round(game.regions[def.region]?.calentura ?? 0)}</dd>
        <dt>Extortion</dt>
        <dd>{known(p.extortionRate)}</dd>
      </dl>
      {mine && (
        <div className="row small">
          Halcones
          <button className="small" disabled={p.halconCoverage <= 0} onClick={() => enqueue({ type: 'set_halcon_coverage', issuer: game.playerId, node: id, coverage: p.halconCoverage - 10 })}>
            −10
          </button>
          <button className="small" disabled={p.halconCoverage >= 100} onClick={() => enqueue({ type: 'set_halcon_coverage', issuer: game.playerId, node: id, coverage: p.halconCoverage + 10 })}>
            +10
          </button>
          <span className="muted">${(content.tuning.economy.halconCostPer10CoveragePerWeek).toLocaleString()} / 10 per week</span>
        </div>
      )}
      {crews.length > 0 && (
        <>
          <h3>Crews here</h3>
          <ul className="links">
            {crews.map((c) => (
              <li key={c.id}>
                <button className="linkish" onClick={() => select({ kind: 'crew', id: c.id })}>
                  {crewLabel(game, c)}
                </button>
                <span className="muted small"> {c.order.type}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {seen.length > 0 && (
        <>
          <h3>Reported here</h3>
          <ul className="mono small">
            {seen.map((s) => (
              <li key={s.id}>
                {s.confidence === 'estimated' ? '~' : ''}
                {s.men} men, {charLabel(game, s.owner)}'s · {s.ageHours}h ago
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
