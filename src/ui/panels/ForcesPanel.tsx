import { useState } from 'react';
import { escortsOf } from '../../sim/crews';
import { crewPayPerWeek, tierLabel } from '../../sim/forces';
import { useGame } from '../store';
import { charLabel, locationName } from '../util';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * Forces and recruitment: every crew and column you pay, what they are worth
 * and cost, plus where to find more men.
 */
export function ForcesPanel() {
  const { content, game, select, enqueue } = useGame();
  const [mercNode, setMercNode] = useState<string>('');
  const [mercMen, setMercMen] = useState(content.tuning.forces.mercenaries.minMen);
  if (!game) return null;
  const me = game.playerId;
  const f = content.tuning.forces;
  const crews = Object.values(game.crews)
    .filter((c) => c.owner === me)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const leaders = crews.filter((c) => c.order.type !== 'escort');
  const men = crews.reduce((n, c) => n + c.men, 0);
  const pay = crews.reduce((n, c) => n + crewPayPerWeek(content.tuning, c), 0);
  const plazas = content.nodes.filter((n) => game.nodes[n.id]!.owner === me);
  const node = mercNode || plazas[0]?.id || '';
  return (
    <div className="forces">
      <p className="small">
        {crews.length} crews · {men} men · payroll {money(pay)}/week
      </p>
      {leaders.length === 0 && <p className="muted">You have no crews.</p>}
      {leaders.map((c) => {
        const column = [c, ...escortsOf(game, c)];
        return (
          <div key={c.id} className={`forcerow ${column.length > 1 ? 'column' : ''}`}>
            {column.length > 1 && <div className="muted small">Column · {column.reduce((n, x) => n + x.men, 0)} men</div>}
            {column.map((x) => (
              <button key={x.id} className="entry" onClick={() => select({ kind: 'crew', id: x.id })}>
                <span className="mono">
                  {charLabel(game, x.leader)} · {x.men} men · {tierLabel(content.tuning, x)}
                </span>
                <span className="muted small">
                  {locationName(content, x.location)} · morale {Math.round(x.morale)} · {money(crewPayPerWeek(content.tuning, x))}/wk
                  {x.training && ` · in camp ${Math.round(x.training.progress * 100)}%`}
                  {x.hired && ` · ${x.hired.kind === 'mercenary' ? 'mercenaries' : 'lent troops'}, loyalty ${Math.round(x.hired.loyalty)}`}
                  {x.battle && ' · fighting'}
                </span>
              </button>
            ))}
          </div>
        );
      })}

      <h3>Recruitment</h3>
      <ul className="small">
        {plazas.map((p) => (
          <li key={p.id}>
            <button className="linkish" onClick={() => select({ kind: 'node', id: p.id })}>
              {p.name}
            </button>{' '}
            <span className="muted">{Math.floor(game.nodes[p.id]!.recruits)} local recruits ready</span>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Local recruits sign on as {tierLabel(content.tuning, { skill: content.tuning.economy.recruitment.recruitSkill, gear: content.tuning.economy.recruitment.recruitGear })} for{' '}
        {money(content.tuning.economy.recruitment.signingCostPerMan)} a man. Veterans ({game.market.veterans} looking for work this week) join a crew at{' '}
        {money(f.veterans.costPerMan)} a man: pick a crew in one of your plazas. Training camps teach up to {f.skillNames[f.training.maxSkill - 1]}, cheaper in the sierra.
      </p>
      {plazas.length > 0 && (
        <>
          <h3>Mercenaries from outside Sinaloa</h3>
          <p className="muted small">
            {tierLabel(content.tuning, f.mercenaries)}, {money(f.mercenaries.costPerMan)} a man up front and {f.mercenaries.payMultiplier}× pay. No cartel recalls them; they leave the week the money stops.
          </p>
          <div className="row small">
            <input type="number" min={f.mercenaries.minMen} max={f.mercenaries.maxMen} value={mercMen} onChange={(e) => setMercMen(Number(e.target.value))} /> men to
            <select value={node} onChange={(e) => setMercNode(e.target.value)}>
              {plazas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button className="small" onClick={() => enqueue({ type: 'hire_mercenaries', issuer: me, node, men: mercMen })}>
              Hire ({money(mercMen * f.mercenaries.costPerMan)})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
