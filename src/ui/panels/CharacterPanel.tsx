import type { SchemeType } from '../../data/schemas';
import { newContext } from '../../sim/context';
import { networkOf } from '../../sim/network';
import { SCHEME_LABEL, schemeBlocked } from '../../sim/systems/schemes';
import { useGame } from '../store';
import { charLabel, playerNetwork } from '../util';
import { Opinion } from './FactionPanel';

const RANK: Record<string, string> = {
  head: 'Faction head',
  inner_circle: 'Inner circle',
  senior_lieutenant: 'Senior lieutenant',
  lieutenant: 'Lieutenant',
  associate: 'Associate',
  crew_leader: 'Crew leader',
};

const SCHEMES_ON_PEOPLE: SchemeType[] = ['flip', 'assassinate', 'frame', 'leak_location', 'compadrazgo'];

/** Character panel (GDD "Character panel"): skills, traits, opinions with breakdowns, relationships, schemes. */
export function CharacterPanel({ id }: { id: string }) {
  const { content, game, enqueue, select } = useGame();
  if (!game) return null;
  const ch = game.characters[id];
  if (!ch) return <p className="muted">Unknown character.</p>;
  const me = game.playerId;
  const isMe = id === me;
  const net = playerNetwork(game);
  const theirs = networkOf(game, id);
  const faction = content.factions.find((f) => f.id === ch.faction);
  const ctx = newContext(game, content);
  const plazas = Object.values(game.nodes).filter((n) => n.owner === id);
  const t = content.tuning;
  const rumorOk = !isMe && theirs !== net && ch.faction !== null && game.factions[ch.faction]?.head !== id && ch.status === 'free';

  return (
    <div>
      <h2>{ch.alias ?? ch.name}</h2>
      <p className="muted">
        {ch.alias ? `${ch.name} · ` : ''}
        {RANK[ch.rank] ?? ch.rank} · {faction ? faction.name : 'Neutral'} · {ch.age} years
        {ch.status !== 'free' && <strong> · {ch.status}</strong>}
      </p>
      <p className="small">
        {ch.traits.map((tid) => {
          const tr = content.traits.find((x) => x.id === tid);
          return (
            <span key={tid} className="trait" title={tr?.description}>
              {tr?.name ?? tid}
            </span>
          );
        })}
      </p>
      <dl>
        <dt>Violencia</dt>
        <dd>{ch.skills.violencia}</dd>
        <dt>Astucia</dt>
        <dd>{ch.skills.astucia}</dd>
        <dt>Negocio</dt>
        <dd>{ch.skills.negocio}</dd>
        <dt>Palabra</dt>
        <dd>{ch.skills.palabra}</dd>
        <dt>Profile</dt>
        <dd>{Math.round(ch.profile)}</dd>
        <dt>Fear · Respect</dt>
        <dd>
          {Math.round(ch.fear)} · {Math.round(ch.respect)}
        </dd>
        <dt>Credibility</dt>
        <dd>{Math.round(ch.credibility)}</dd>
        {isMe && (
          <>
            <dt>State intel</dt>
            <dd className={ch.stateIntel >= 70 ? 'warn' : ''}>{Math.round(ch.stateIntel)} / 100</dd>
            <dt>Goal</dt>
            <dd>{ch.goal.replace(/_/g, ' ')}</dd>
          </>
        )}
      </dl>
      {!isMe && (
        <p className="small">
          Thinks of you: <Opinion from={id} to={me} /> · You of them: <Opinion from={me} to={id} />
        </p>
      )}
      {ch.relations.length > 0 && (
        <>
          <h3>Relationships</h3>
          <ul className="links small">
            {ch.relations.map((r, i) => (
              <li key={i}>
                {r.type}:{' '}
                <button className="linkish" onClick={() => select({ kind: 'character', id: r.target })}>
                  {charLabel(game, r.target)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {plazas.length > 0 && (
        <>
          <h3>Plazas</h3>
          <ul className="links small">
            {plazas.map((p) => (
              <li key={p.id}>
                <button className="linkish" onClick={() => select({ kind: 'node', id: p.id })}>
                  {content.nodes.find((n) => n.id === p.id)?.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!isMe && ch.status === 'free' && (
        <>
          <h3>Schemes</h3>
          <div className="actions">
            {SCHEMES_ON_PEOPLE.map((type) => {
              const blocked = schemeBlocked(ctx, me, type, id);
              const cost = t.schemes.types[type].cost;
              return (
                <button key={type} className="small" disabled={blocked !== null} title={blocked ?? `$${cost.toLocaleString()} up front`} onClick={() => enqueue({ type: 'start_scheme', issuer: me, scheme: type, target: id })}>
                  {SCHEME_LABEL[type]}
                </button>
              );
            })}
            {rumorOk && (
              <button
                className="small"
                title={`$${t.infowar.rumor.cost.toLocaleString()}: tell his head he is talking to the other side`}
                onClick={() => enqueue({ type: 'plant_rumor', issuer: me, network: theirs, kind: 'fake_betrayal', subject: id })}
              >
                Rumor: he's a traitor
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
