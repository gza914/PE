import { fmtRange } from '../../sim/estimate';
import { lastSeen } from '../../sim/knowledge';
import { crewNetwork, networkOf } from '../../sim/network';
import { useGame } from '../store';
import { PlazaEconomy } from './PlazaEconomy';
import { PlazaShadowActions } from './PlazaShadowActions';
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
        <dd>
          {owner ? (
            <button className="linkish" onClick={() => select({ kind: 'character', id: owner.id })}>
              {charLabel(game, owner.id)}
            </button>
          ) : def.hasSubmap ? (
            'Contested (see Culiacán view)'
          ) : (
            'None'
          )}
        </dd>
        <dt>Fortification</dt>
        <dd>{p.fortification} / 3</dd>
        <dt>Support</dt>
        <dd>{known(p.support)}</dd>
        <dt>Halcones</dt>
        <dd>{known(p.halconCoverage)}</dd>
        <dt>Businesses</dt>
        <dd>{Math.round(p.businesses)}</dd>
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
          <button className="small" disabled={p.halconCoverage <= 0} onClick={() => enqueue({ type: 'set_halcon_coverage', issuer: game.playerId, node: id, coverage: Math.max(0, p.halconCoverage - 10) })}>
            −10
          </button>
          <button className="small" disabled={p.halconCoverage >= 100} onClick={() => enqueue({ type: 'set_halcon_coverage', issuer: game.playerId, node: id, coverage: Math.min(100, p.halconCoverage + 10) })}>
            +10
          </button>
          <span className="muted">${(content.tuning.economy.halconCostPer10CoveragePerWeek).toLocaleString()} / 10 per week</span>
        </div>
      )}
      {mine && <PlazaEconomy id={id} />}
      <PlazaShadowActions id={id} />
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
      {game.countryside[id] && (
        <>
          <h3>The countryside</h3>
          <p className="small">
            {Object.keys(game.countryside[id]!).length === 0
              ? 'No one holds the hills.'
              : Object.keys(game.countryside[id]!)
                  .sort((a, b) => game.countryside[id]![b]! - game.countryside[id]![a]!)
                  .map((k) => `${content.factions.find((f) => f.id === k)?.name ?? charLabel(game, k)} ${Math.round(game.countryside[id]![k]!)}`)
                  .join(' · ')}
          </p>
          <p className="muted small">Camps raise a side's hold on the hills; the holder's support keeps its own. The hills count for {Math.round(content.tuning.countryside.shareWeight * 100)}% of the plaza's value in the share of the map.</p>
        </>
      )}
      {seen.length > 0 && (
        <>
          <h3>Reported here</h3>
          <ul className="mono small">
            {seen.map((s) => (
              <li key={s.id}>
                {fmtRange(s)} men, {charLabel(game, s.owner)}'s · {s.ageHours}h ago{s.sources && s.sources > 1 ? ` · ${s.sources} sources` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
