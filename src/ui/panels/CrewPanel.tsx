import { useState } from 'react';
import type { OrderRequest } from '../../sim/commands';
import { escortsOf, sameLocation } from '../../sim/crews';
import { crewNetwork } from '../../sim/network';
import { seats, VEHICLE_TYPES } from '../../sim/signature';
import type { CrewState } from '../../sim/state';
import { world } from '../../sim/world';
import { useGame } from '../store';
import { charLabel, crewLabel, fmtHours, locationName, playerNetwork, vehicleSummary } from '../util';
import { RoutePlanner } from './RoutePlanner';

function orderText(game: ReturnType<typeof useGame.getState>['game'], content: ReturnType<typeof useGame.getState>['content'], c: CrewState): string {
  const o = c.order;
  const w = world(content);
  switch (o.type) {
    case 'move':
      return o.departAt !== null && game!.hour < o.departAt
        ? `Waiting to leave for ${w.node(o.destination).name} (${fmtHours(o.departAt - game!.hour)})`
        : `Moving to ${w.node(o.destination).name}`;
    case 'retreat':
      return `Retreating to ${w.node(o.destination).name}`;
    case 'ambush':
    case 'patrol':
      return `${o.type === 'ambush' ? 'Ambush' : 'Patrol'} on ${w.node(w.road(o.road).from).name}–${w.node(w.road(o.road).to).name}${o.atKm === null ? ' (getting into position)' : ''}`;
    case 'escort':
      return `Escorting ${charLabel(game!, game!.crews[o.crew]?.leader ?? '')}`;
    case 'lie_low':
      return 'Lying low (invisible, cannot act)';
    default:
      return o.type[0]!.toUpperCase() + o.type.slice(1);
  }
}

export function CrewPanel({ crew }: { crew: CrewState }) {
  const { content, game, plan, set, enqueue, queue } = useGame();
  const [splitMen, setSplitMen] = useState(4);
  const [splitVeh, setSplitVeh] = useState<Record<string, number>>({ pickup: 1 });
  const [showSplit, setShowSplit] = useState(false);
  if (!game) return null;
  const mine = crewNetwork(game, crew) === playerNetwork(game) && crew.owner === game.playerId;
  const order = (o: OrderRequest) => enqueue({ type: 'order_crew', issuer: crew.owner, crew: crew.id, order: o });
  const w = world(content);
  const here = Object.values(game.crews).filter((c) => c.id !== crew.id && c.owner === crew.owner && sameLocation(content, c.location, crew.location));
  const escorts = escortsOf(game, crew);
  const pending = queue.filter((q) => ('crew' in q && q.crew === crew.id) || (q.type === 'merge_crews' && q.into === crew.id));
  const roads = crew.location.kind === 'node' ? w.neighbors(crew.location.node).map((n) => n.road) : [w.road(crew.location.road)];

  return (
    <div>
      <h2>{charLabel(game, crew.leader)}'s crew</h2>
      <p className="muted">
        {charLabel(game, crew.owner)} · {locationName(content, crew.location)}
      </p>
      <dl>
        <dt>Men</dt>
        <dd>{crew.men}</dd>
        <dt>Skill / Gear</dt>
        <dd>
          {crew.skill} / {crew.gear}
        </dd>
        <dt>Vehicles</dt>
        <dd>{vehicleSummary(crew.vehicles)}</dd>
        <dt>Morale</dt>
        <dd>{Math.round(crew.morale)}</dd>
        <dt>Alertness</dt>
        <dd>{Math.round(crew.alertness)}</dd>
        <dt>Ammo</dt>
        <dd>{Math.round(crew.ammo)}%</dd>
        <dt>Fatigue</dt>
        <dd>{Math.round(crew.fatigue)}</dd>
        <dt>Order</dt>
        <dd>{orderText(game, content, crew)}</dd>
        {crew.transit.waitUntil !== null && game.hour < crew.transit.waitUntil && (
          <>
            <dt>Delay</dt>
            <dd>Broken down, {crew.transit.waitUntil - game.hour}h</dd>
          </>
        )}
      </dl>
      {escorts.length > 0 && <p className="small">Escorted by {escorts.map((e) => crewLabel(game, e)).join(', ')}</p>}
      {pending.length > 0 && <p className="small pending">Order queued: applies on the next hour.</p>}

      {mine && plan?.crew === crew.id && <RoutePlanner />}
      {mine && plan?.crew !== crew.id && (
        <>
          <h3>Orders</h3>
          <div className="btns">
            <button onClick={() => set({ plan: { crew: crew.id, destination: null, waypoints: [] } })}>Move…</button>
            {crew.location.kind === 'node' && <button onClick={() => order({ type: 'garrison' })}>Garrison</button>}
            {crew.location.kind === 'node' && <button onClick={() => order({ type: 'lie_low' })}>Lie low</button>}
            <button onClick={() => order({ type: 'retreat' })}>Retreat</button>
            <button onClick={() => order({ type: 'idle' })}>Stop</button>
          </div>
          <h3>Hold a road</h3>
          <div className="btns col">
            {roads.map((r) => (
              <div key={r.id} className="row small">
                <span className="grow">
                  {w.node(r.from).name}–{w.node(r.to).name} <span className="muted">({r.type})</span>
                </span>
                <button className="small" onClick={() => order({ type: 'ambush', road: r.id })}>
                  Ambush
                </button>
                <button className="small" onClick={() => order({ type: 'patrol', road: r.id })}>
                  Patrol
                </button>
              </div>
            ))}
          </div>
          {here.length > 0 && (
            <>
              <h3>Crews here</h3>
              <div className="btns col">
                {here.map((c) => (
                  <div key={c.id} className="row small">
                    <span className="grow">{crewLabel(game, c)}</span>
                    {c.order.type !== 'escort' && (
                      <button className="small" onClick={() => order({ type: 'escort', crew: c.id })} title="This crew escorts that one">
                        Escort
                      </button>
                    )}
                    {crew.location.kind === 'node' && (
                      <button className="small" onClick={() => enqueue({ type: 'merge_crews', issuer: crew.owner, crew: c.id, into: crew.id })}>
                        Merge in
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {crew.location.kind === 'node' && (
            <>
              <button className="linkish" onClick={() => setShowSplit(!showSplit)}>
                {showSplit ? '▾' : '▸'} Split crew
              </button>
              {showSplit && (
                <div className="split small">
                  <label className="row">
                    Men
                    <input type="number" min={4} max={crew.men - 4} value={splitMen} onChange={(e) => setSplitMen(Number(e.target.value))} />
                  </label>
                  {VEHICLE_TYPES.filter((v) => crew.vehicles[v] > 0).map((v) => (
                    <label key={v} className="row">
                      {v}
                      <input
                        type="number"
                        min={0}
                        max={crew.vehicles[v]}
                        value={splitVeh[v] ?? 0}
                        onChange={(e) => setSplitVeh({ ...splitVeh, [v]: Number(e.target.value) })}
                      />
                    </label>
                  ))}
                  <p className="muted">
                    Seats in new crew: {seats({ vehicles: { pickup: 0, suv: 0, motorcycle: 0, armored: 0, ...splitVeh } }, content.tuning)}
                  </p>
                  <button onClick={() => enqueue({ type: 'split_crew', issuer: crew.owner, crew: crew.id, men: splitMen, vehicles: splitVeh })}>Split</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
