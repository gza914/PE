import { useState } from 'react';
import type { ExtortionRate } from '../../data/schemas';
import { dailyIncome, recruitPoolCap } from '../../sim/systems/economy';
import { useGame } from '../store';

const RATES: ExtortionRate[] = ['low', 'medium', 'high', 'brutal'];
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/** Money controls for a plaza the player holds. */
export function PlazaEconomy({ id }: { id: string }) {
  const { content, game, enqueue } = useGame();
  const [men, setMen] = useState(8);
  const [leader, setLeader] = useState('');
  if (!game) return null;
  const p = game.nodes[id]!;
  const e = content.tuning.economy;
  const lines = dailyIncome(game, content).filter((l) => l.recipient === game.playerId && (l.node === id || l.source === id));
  const perDay = lines.reduce((n, l) => n + l.amount, 0);
  const pool = Math.floor(p.recruits);
  const leaders = Object.values(game.characters).filter(
    (c) => c.status === 'free' && (c.id === game.playerId || (c.rank === 'crew_leader' && c.faction !== null && c.faction === game.characters[game.playerId]!.faction)),
  );
  const pickups = Math.ceil(men / content.tuning.vehicles.pickup.seats);
  const cost = men * e.recruitment.signingCostPerMan + pickups * content.tuning.vehicles.pickup.cost;

  return (
    <div className="plazaecon">
      <h3>Money</h3>
      <dl className="small">
        <dt>Earns</dt>
        <dd>{money(perDay)} / day</dd>
        <dt>Stash</dt>
        <dd>{money(p.stash)}</dd>
        <dt>Halcones cost</dt>
        <dd>{money((p.halconCoverage / 10) * e.halconCostPer10CoveragePerWeek)} / week</dd>
      </dl>
      <ul className="small mono plain">
        {lines.map((l, i) => (
          <li key={i}>
            {l.stream}
            {l.source.startsWith('route_') ? ` (${content.routes.find((r) => r.id === l.source)?.name})` : ''}: {money(l.amount)}
          </li>
        ))}
      </ul>
      <p className="small">Cobro de piso</p>
      <div className="btns">
        {RATES.map((r) => (
          <button
            key={r}
            className={`small${p.extortionRate === r ? ' on' : ''}`}
            onClick={() => enqueue({ type: 'set_extortion_rate', issuer: game.playerId, node: id, rate: r })}
            title={`${money(e.extortionRates[r].incomePerBusinessPerDay)} per business per day · support ${e.extortionRates[r].supportPerWeek >= 0 ? '+' : ''}${e.extortionRates[r].supportPerWeek}/week · ${Math.round(e.extortionRates[r].businessClosurePerWeek * 100)}% close per week`}
          >
            {r}
          </button>
        ))}
      </div>
      <h3>Recruits</h3>
      <p className="small">
        {pool} ready to sign up (holds up to {Math.floor(recruitPoolCap(content, id, p.businesses))}). {money(e.recruitment.signingCostPerMan)} a head.
      </p>
      {pool >= content.tuning.crews.minMen && (
        <div className="small">
          <div className="row">
            Raise a crew of
            <input type="number" min={content.tuning.crews.minMen} max={Math.min(pool, content.tuning.crews.maxMen)} value={men} onChange={(ev) => setMen(Number(ev.target.value))} />
            led by
            <select value={leader} onChange={(ev) => setLeader(ev.target.value)}>
              <option value="">yourself</option>
              {leaders
                .filter((c) => c.id !== game.playerId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.alias ?? c.name}
                  </option>
                ))}
            </select>
          </div>
          <button className="small" onClick={() => enqueue({ type: 'form_crew', issuer: game.playerId, node: id, men, ...(leader ? { leader } : {}) })}>
            Raise crew ({money(cost)} with {pickups} pickups)
          </button>
        </div>
      )}
    </div>
  );
}
