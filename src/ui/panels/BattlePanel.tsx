import { useMemo } from 'react';
import { groupOf } from '../../sim/crews';
import { battleEnemies } from '../../sim/knowledge';
import { crewNetwork } from '../../sim/network';
import { travelHours } from '../../sim/routing';
import type { Battle, CrewState } from '../../sim/state';
import { world } from '../../sim/world';
import { useGame } from '../store';
import { charLabel, fmtHours, playerNetwork } from '../util';

const TYPE_LABEL: Record<Battle['type'], string> = {
  ambush: 'Ambush',
  road_clash: 'Road clash',
  raid: 'Raid',
  siege: 'Siege',
  urban_skirmish: 'Street fighting',
  military_clash: 'Military clash',
  sweep: 'Sweep of the hills',
};

function CrewRow({ c, detail }: { c: CrewState; detail: boolean }) {
  const game = useGame((s) => s.game)!;
  return (
    <li>
      {charLabel(game, c.leader)} · {c.men} men
      {c.vehicles.armored > 0 && <span className="muted"> · {c.vehicles.armored} armored</span>}
      {detail && (
        <span className="muted small">
          {' '}
          · morale {Math.round(c.morale)} · ammo {Math.round(c.ammo)}%
        </span>
      )}
    </li>
  );
}

export function BattlePanel({ battle }: { battle: Battle }) {
  const { content, game, enqueue, queue, select } = useGame();
  const net = game ? playerNetwork(game) : '';
  const mySide = battle.attackers.network === net ? 'attackers' : battle.defenders.network === net ? 'defenders' : null;
  const reserves = useMemo(() => {
    if (!game || !mySide || battle.endedAt !== null) return [];
    const targets = battle.where.kind === 'node' ? [battle.where.node] : [battle.where.from, battle.where.to];
    return Object.values(game.crews)
      .filter((c) => c.owner === game.playerId && c.battle === null && c.order.type !== 'escort')
      .map((c) => {
        const hours = travelHours(game, content, { crews: groupOf(game, c), from: c.location, preference: 'fastest', departHour: game.hour, viewer: net });
        return { c, eta: Math.min(...targets.map((t) => hours.get(t) ?? Infinity)) };
      })
      .filter((r) => r.eta <= 12)
      .sort((a, b) => a.eta - b.eta);
  }, [game, content, battle, mySide, net]);
  if (!game) return null;

  const w = world(content);
  const where = battle.colonia
    ? content.culiacan.colonias.find((c) => c.id === battle.colonia)?.name
    : battle.where.kind === 'node'
      ? w.node(battle.where.node).name
      : `${w.node(w.road(battle.where.road).from).name}–${w.node(w.road(battle.where.road).to).name}`;
  const factionName = (n: string) => content.factions.find((f) => f.id === n)?.name ?? charLabel(game, n);
  const side = (k: 'attackers' | 'defenders') => {
    const s = battle[k];
    const mine = k === mySide;
    const list = mine
      ? s.crews.map((id) => game.crews[id]).filter((c): c is CrewState => !!c)
      : mySide
        ? battleEnemies(game, net, battle)
        : [];
    return (
      <div className={`side ${mine ? 'mine' : ''}`}>
        <h3>
          {k === 'attackers' ? 'Attackers' : 'Defenders'}: {factionName(s.network)}
        </h3>
        <p className="mono small">
          Power {Math.round(s.power)} · lost {s.casualties} men{s.helpCalled ? ' · help called' : ''}
        </p>
        {list.length > 0 ? (
          <ul className="small">
            {list.map((c) => (
              <CrewRow key={c.id} c={c} detail={mine} />
            ))}
          </ul>
        ) : (
          !mine && <p className="muted small">{mySide ? 'No one left standing.' : 'Details unknown.'}</p>
        )}
      </div>
    );
  };

  const mine = mySide ? battle[mySide].crews.map((id) => game.crews[id]).filter((c): c is CrewState => !!c && c.owner === game.playerId) : [];
  const queued = (type: string) => queue.some((q) => q.type === type && 'battle' in q && q.battle === battle.id);
  const cmd = (type: 'battle_withdraw' | 'battle_armor_forward' | 'battle_call_help' | 'battle_accept_surrender') =>
    enqueue({ type, issuer: game.playerId, battle: battle.id });
  const total = battle.attackers.power + battle.defenders.power;

  return (
    <div>
      <h2>
        {TYPE_LABEL[battle.type]} at {where}
      </h2>
      <p className="muted">
        {battle.endedAt === null ? `Hour ${battle.hours}` : `Over after ${battle.hours}h: ${battle.winner ?? 'no'} ${battle.winner ? 'won' : 'winner'}`}
        {battle.fortification > 0 && ` · fortification ${battle.fortification}`}
      </p>
      {total > 0 && (
        <div className="powerbar" title="Share of the fighting power last hour">
          <div className="att" style={{ width: `${(battle.attackers.power / total) * 100}%` }} />
        </div>
      )}
      {battle.type === 'siege' && (
        <p className="small">
          Siege progress {Math.round(battle.siegeProgress)}%
          <span className="bar">
            <span style={{ width: `${battle.siegeProgress}%` }} />
          </span>
        </p>
      )}
      {side('attackers')}
      {side('defenders')}

      {mySide && battle.endedAt === null && mine.length > 0 && (
        <>
          <h3>Decisions</h3>
          <div className="btns col">
            <button disabled={queued('battle_withdraw')} onClick={() => cmd('battle_withdraw')}>
              Withdraw in good order
            </button>
            {mine.some((c) => c.vehicles.armored > 0) && (
              <button disabled={queued('battle_armor_forward')} onClick={() => cmd('battle_armor_forward')} title="Double the trucks' punch for an hour; double the damage they take">
                Send the armored truck forward
              </button>
            )}
            <button disabled={battle[mySide].helpCalled || queued('battle_call_help')} onClick={() => cmd('battle_call_help')}>
              Call for help from the faction
            </button>
            {battle.prompted.includes('enemy_wavering') && (
              <button disabled={queued('battle_accept_surrender')} onClick={() => cmd('battle_accept_surrender')}>
                Accept their surrender
              </button>
            )}
          </div>
        </>
      )}
      {mySide && battle.endedAt === null && reserves.length > 0 && (
        <>
          <h3>Commit reserves</h3>
          <ul className="links small">
            {reserves.map(({ c, eta }) => (
              <li key={c.id} className="row">
                <span className="grow">
                  {charLabel(game, c.leader)} · {c.men} men · {eta < 0.01 ? 'here' : fmtHours(eta)}
                </span>
                <button
                  className="small"
                  disabled={c.order.type === 'reinforce' || queue.some((q) => q.type === 'battle_commit' && q.crew === c.id)}
                  onClick={() => enqueue({ type: 'battle_commit', issuer: game.playerId, battle: battle.id, crew: c.id })}
                >
                  {c.order.type === 'reinforce' ? 'On the way' : 'Commit'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Battle log</h3>
      <ul className="log mono small">
        {[...battle.log].reverse().slice(0, 20).map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {!mySide && <p className="muted small">Your network is not in this fight; you only hear the shooting.</p>}
      {mySide &&
        battle[mySide].crews
          .map((id) => game.crews[id])
          .filter((c): c is CrewState => !!c && c.owner === game.playerId && crewNetwork(game, c) === net)
          .slice(0, 1)
          .map((c) => (
            <button key={c.id} className="linkish" onClick={() => select({ kind: 'crew', id: c.id })}>
              Open {charLabel(game, c.leader)}'s crew
            </button>
          ))}
    </div>
  );
}
