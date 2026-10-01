import { useState } from 'react';
import type { OrderRequest } from '../../sim/commands';
import { newContext } from '../../sim/context';
import { escortsOf, sameLocation } from '../../sim/crews';
import { crewPayPerWeek, gearName, skillName, tierLabel, trainingBlocked, trainingCostPerDay, weaponsCost } from '../../sim/forces';
import { campBlocked } from '../../sim/countryside';
import { crewNetwork, networkOf } from '../../sim/network';
import { seats, VEHICLE_TYPES } from '../../sim/signature';
import type { CrewState } from '../../sim/state';
import { world } from '../../sim/world';
import type { VehicleType } from '../../data/schemas';
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
    case 'raid':
      return `Raiding ${w.node(o.target).name}`;
    case 'reinforce':
      return 'Riding to reinforce a battle';
    case 'escort':
      return `In a column with ${charLabel(game!, game!.crews[o.crew]?.leader ?? '')}'s crew`;
    case 'lie_low':
      return 'Lying low (invisible, cannot act)';
    case 'camp':
      return `Camped in the hills around ${c.location.kind === 'node' ? w.node(c.location.node).name : 'here'}`;
    default:
      return o.type[0]!.toUpperCase() + o.type.slice(1);
  }
}

export function CrewPanel({ crew }: { crew: CrewState }) {
  const { content, game, plan, set, enqueue, queue, select } = useGame();
  const [splitMen, setSplitMen] = useState(4);
  const [splitVeh, setSplitVeh] = useState<Record<string, number>>({ pickup: 1 });
  const [showSplit, setShowSplit] = useState(false);
  const [recruitN, setRecruitN] = useState(4);
  const [buyN, setBuyN] = useState(1);
  const [buyType, setBuyType] = useState<VehicleType>('pickup');
  const [gearTo, setGearTo] = useState(Math.min(5, crew.gear + 1));
  const [vetN, setVetN] = useState(4);
  if (!game) return null;
  const mine = crewNetwork(game, crew) === playerNetwork(game) && crew.owner === game.playerId;
  const order = (o: OrderRequest) => enqueue({ type: 'order_crew', issuer: crew.owner, crew: crew.id, order: o });
  const w = world(content);
  const here = Object.values(game.crews).filter((c) => c.id !== crew.id && c.owner === crew.owner && sameLocation(content, c.location, crew.location));
  const escorts = escortsOf(game, crew);
  const pending = queue.filter((q) => ('crew' in q && q.crew === crew.id) || (q.type === 'merge_crews' && q.into === crew.id));
  const inCity = crew.location.kind === 'node' && crew.location.node === content.culiacan.parentNode;
  const ownPlaza = crew.location.kind === 'node' ? game.nodes[crew.location.node] : undefined;
  const atOwnPlaza = !!ownPlaza && ownPlaza.owner === crew.owner && crew.battle === null;
  const pool = ownPlaza?.recruits ?? 0;
  const gearPick = gearTo > crew.gear ? gearTo : Math.min(5, crew.gear + 1);
  const trainBlock = atOwnPlaza ? trainingBlocked(newContext(game, content), crew.owner, crew) : 'not in your plaza';
  const trainCost = crew.location.kind === 'node' ? trainingCostPerDay(newContext(game, content), crew, crew.location.node) : 0;
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
        <dd title={`skill ${crew.skill}, gear ${crew.gear}`}>{tierLabel(content.tuning, crew)}</dd>
        <dt>Pay</dt>
        <dd>${Math.round(crewPayPerWeek(content.tuning, crew)).toLocaleString()}/week</dd>
        {crew.hired && (
          <>
            <dt>Hired</dt>
            <dd>
              {crew.hired.kind === 'mercenary' ? 'Mercenaries' : `Lent by ${content.factions.find((f) => f.id === crew.hired!.from)?.name ?? 'an outside cartel'}`} · loyalty {Math.round(crew.hired.loyalty)}
              {crew.hired.recallAt !== null && ` · called home in ${fmtHours(crew.hired.recallAt - game.hour)}`}
            </dd>
            {crew.hired.defectOffer !== null && mine && (
              <dd>
                They offer to stay as your own men.{' '}
                <button className="small" title="They become your crew; their cartel becomes your enemy" onClick={() => enqueue({ type: 'answer_defection', issuer: crew.owner, crew: crew.id, accept: true })}>
                  Take them on
                </button>{' '}
                <button className="small" onClick={() => enqueue({ type: 'answer_defection', issuer: crew.owner, crew: crew.id, accept: false })}>
                  Say no
                </button>
              </dd>
            )}
          </>
        )}
        {crew.training && (
          <>
            <dt>Training</dt>
            <dd>{Math.round(crew.training.progress * 100)}% toward {skillName(content.tuning, crew.skill + 1)}</dd>
          </>
        )}
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

      {crew.battle !== null && game.battles[crew.battle] && (
        <p className="inbattle">
          Fighting now.{' '}
          <button className="linkish" onClick={() => select({ kind: 'battle', id: crew.battle! })}>
            Open the battle
          </button>
        </p>
      )}
      {mine && inCity && crew.battle === null && (
        <p className="small">
          {crew.colonia ? (
            <>
              Holding {content.culiacan.colonias.find((c) => c.id === crew.colonia)?.name}.{' '}
              <button className="linkish" onClick={() => enqueue({ type: 'deploy_crew', issuer: crew.owner, crew: crew.id, colonia: null })}>
                Pull back
              </button>
            </>
          ) : (
            'In Culiacán but not committed to a colonia. Open the Culiacán view to deploy.'
          )}
        </p>
      )}
      {mine && plan?.crew === crew.id && <RoutePlanner />}
      {mine && plan?.crew !== crew.id && crew.battle === null && (
        <>
          <h3>Orders</h3>
          <div className="btns">
            <button onClick={() => set({ plan: { kind: 'move', crew: crew.id, destination: null, waypoints: [] } })}>Move…</button>
            <button onClick={() => set({ plan: { kind: 'raid', crew: crew.id, destination: null, waypoints: [] } })}>Raid…</button>
            {crew.location.kind === 'node' && <button onClick={() => order({ type: 'garrison' })}>Garrison</button>}
            {crew.location.kind === 'node' && <button onClick={() => order({ type: 'lie_low' })}>Lie low</button>}
            {crew.location.kind === 'node' && campBlocked(content, crew.location.node) === null && crew.order.type !== 'camp' && (
              <button title="Out of town, hard to find: raises your side's hold on the countryside; strike the town when the garrison is weak" onClick={() => order({ type: 'camp' })}>
                Camp in the hills
              </button>
            )}
            {crew.location.kind === 'node' && crew.order.type === 'camp' && game.nodes[crew.location.node]!.owner !== null && crewNetwork(game, crew) !== networkOf(game, game.nodes[crew.location.node]!.owner!) && (
              <button title="Hit the town from the hills" onClick={() => order({ type: 'raid', target: (crew.location as { node: string }).node, preference: 'fastest' })}>
                Strike the town
              </button>
            )}
            {crew.location.kind === 'node' && campBlocked(content, crew.location.node) === null && crew.order.type !== 'camp' && (
              <button title="Comb the hills for enemy camps: a fight in which they have the terrain" onClick={() => enqueue({ type: 'sweep', issuer: crew.owner, crew: crew.id })}>
                Sweep the hills
              </button>
            )}
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
                      <button className="small" onClick={() => order({ type: 'escort', crew: c.id })} title={`Join that crew as a column (at most ${content.tuning.forces.column.maxCrews} crews, ${content.tuning.forces.column.maxMen} men): one unit that moves and fights together`}>
                        Form column
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
          {atOwnPlaza && (
            <>
              <h3>Reinforce</h3>
              <div className="row small">
                Sign
                <input type="number" min={1} max={Math.max(1, Math.floor(pool))} value={recruitN} onChange={(e) => setRecruitN(Number(e.target.value))} />
                men
                <button className="small" disabled={Math.floor(pool) < 1} onClick={() => enqueue({ type: 'recruit', issuer: crew.owner, crew: crew.id, men: recruitN })}>
                  Recruit (${(recruitN * content.tuning.economy.recruitment.signingCostPerMan).toLocaleString()})
                </button>
              </div>
              <p className="muted small">
                {Math.floor(pool)} available here · {seats(crew, content.tuning) - crew.men} free seats
                {crew.men < crew.establishment && ` · ${crew.establishment - crew.men} under strength`}
              </p>
              <div className="row small">
                Buy
                <input type="number" min={1} value={buyN} onChange={(e) => setBuyN(Number(e.target.value))} />
                <select value={buyType} onChange={(e) => setBuyType(e.target.value as VehicleType)}>
                  {VEHICLE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v} (${content.tuning.vehicles[v].cost.toLocaleString()})
                    </option>
                  ))}
                </select>
                <button className="small" onClick={() => enqueue({ type: 'buy_vehicles', issuer: crew.owner, crew: crew.id, vehicle: buyType, count: buyN })}>
                  Buy
                </button>
              </div>
              {buyType === 'armored' && <p className="muted small">{game.market.armored} armored trucks for sale statewide.</p>}
              <h3>Better men</h3>
              <div className="row small">
                Arm with
                <select value={gearPick} onChange={(e) => setGearTo(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5]
                    .filter((g) => g > crew.gear)
                    .map((g) => (
                      <option key={g} value={g}>
                        {gearName(content.tuning, g)} (${weaponsCost(content.tuning, crew, g).toLocaleString()})
                      </option>
                    ))}
                </select>
                <button className="small" disabled={crew.gear >= 5} onClick={() => enqueue({ type: 'buy_weapons', issuer: crew.owner, crew: crew.id, gear: gearPick })}>
                  Buy weapons
                </button>
              </div>
              <div className="row small">
                {crew.training ? (
                  <button className="small" onClick={() => enqueue({ type: 'stop_training', issuer: crew.owner, crew: crew.id })}>
                    Leave the camp
                  </button>
                ) : (
                  <button className="small" disabled={!!trainBlock} title={trainBlock ?? `$${Math.round(trainCost).toLocaleString()}/day; raises calentura; rivals may hear of it`} onClick={() => enqueue({ type: 'train_crew', issuer: crew.owner, crew: crew.id })}>
                    Training camp (${Math.round(trainCost).toLocaleString()}/day)
                  </button>
                )}
              </div>
              <div className="row small">
                Hire
                <input type="number" min={1} max={Math.max(1, game.market.veterans)} value={vetN} onChange={(e) => setVetN(Number(e.target.value))} />
                veterans
                <button className="small" disabled={game.market.veterans < 1} onClick={() => enqueue({ type: 'hire_veterans', issuer: crew.owner, crew: crew.id, men: vetN })}>
                  Hire (${(vetN * content.tuning.forces.veterans.costPerMan).toLocaleString()})
                </button>
              </div>
              <p className="muted small">{game.market.veterans} ex-soldiers and ex-police looking for work this week.</p>
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
