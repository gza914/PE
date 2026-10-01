import { useState } from 'react';
import { formatDateTime } from '../../sim/clock';
import { rivalPlazaIds } from '../../sim/commands';
import { groupOf } from '../../sim/crews';
import { onOperation } from '../../sim/operations';
import { PACT_LABEL, pactBlocked, type PactSpec } from '../../sim/pacts';
import { onDuty } from '../../sim/requests';
import { travelHours } from '../../sim/routing';
import type { Id, JointOp, OpInvite, PactType } from '../../sim/state';
import { useGame } from '../store';
import { OutsidePanel } from './OutsidePanel';
import { charLabel, fmtHours, playerNetwork } from '../util';
import { Opinion } from './FactionPanel';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const STATUS: Record<OpInvite['status'], string> = {
  pending: 'thinking it over',
  accepted: 'in',
  declined: 'no',
  countered: 'counter-offer',
  withdrawn: 'pulled out',
};

/**
 * Diplomacy (GDD "Pacts and the Diplomacy screen"): joint operations you are
 * invited to or running, pact offers, your pacts, and a form to offer one.
 */
export function DiplomacyPanel() {
  const [view, setView] = useState<'side' | 'outside'>('side');
  const outsideCount = useGame((s) => (s.game ? s.game.outsideDeals.filter((d) => d.client === s.game!.playerId && d.status === 'open' && d.counter).length : 0));
  return (
    <>
      <div className="actions">
        <button className={`small ${view === 'side' ? 'on' : ''}`} onClick={() => setView('side')}>
          Bosses
        </button>
        <button className={`small ${view === 'outside' ? 'on' : ''}`} onClick={() => setView('outside')}>
          Outside cartels{outsideCount > 0 && <span className="badge">{outsideCount}</span>}
        </button>
      </div>
      {view === 'side' ? <Peers /> : <OutsidePanel />}
    </>
  );
}

function Peers() {
  const { content, game, enqueue, queue, select } = useGame();
  if (!game) return null;
  const me = game.playerId;
  const queued = (pred: (c: (typeof queue)[number]) => boolean) => queue.some(pred);
  const invites = game.operations.filter((o) => o.status === 'planning' && o.invites.some((i) => i.to === me && (i.status === 'pending' || i.status === 'accepted')));
  const mine = game.operations.filter((o) => o.proposer === me);
  const others = game.operations.filter((o) => o.status !== 'planning' && o.invites.some((i) => i.to === me && i.status === 'accepted'));
  const offers = game.pactOffers.filter((o) => o.to === me);
  const myOffers = game.pactOffers.filter((o) => o.from === me);
  const pacts = game.pacts.filter((p) => p.parties.includes(me) && (p.expiresAt === null || p.expiresAt > game.hour));
  const name = (id: Id) => content.nodes.find((n) => n.id === id)?.name ?? id;

  return (
    <div className="diplomacy">
      <h3>Invitations</h3>
      {invites.length === 0 && <p className="muted small">No one has asked you to join anything.</p>}
      {invites.map((op) => (
        <Invitation key={op.id} op={op} />
      ))}

      <h3>Your operations</h3>
      {mine.length === 0 && <p className="muted small">Plan one from a plaza: "Plan joint attack" on a rival plaza, or "Ask for help holding" on one of yours.</p>}
      {mine.map((op) => (
        <div key={op.id} className="request small">
          <OpHeader op={op} />
          {op.invites.map((i) => (
            <div key={i.to} className="row">
              <button className="linkish" onClick={() => select({ kind: 'character', id: i.to })}>
                {charLabel(game, i.to)}
              </button>
              <span className={i.status === 'accepted' ? 'pos' : i.status === 'declined' ? 'muted' : ''}>{STATUS[i.status]}</span>
              {i.reason && i.status !== 'accepted' && <span className="muted">: {i.reason}</span>}
              {i.status === 'accepted' && <span className="muted">{i.crews.reduce((n, id) => n + (game.crews[id]?.men ?? 0), 0)} men</span>}
              {i.status === 'countered' && op.status === 'planning' && (
                <button className="small" disabled={queued((c) => c.type === 'accept_counter' && c.op === op.id && c.invitee === i.to)} onClick={() => enqueue({ type: 'accept_counter', issuer: me, op: op.id, invitee: i.to })}>
                  Agree{i.counter?.plaza ? ' (he gets the plaza)' : i.counter ? ` (${money(i.counter.cash)})` : ''}
                </button>
              )}
            </div>
          ))}
          {op.status === 'planning' && (
            <button className="small" onClick={() => enqueue({ type: 'cancel_operation', issuer: me, op: op.id })}>
              Call it off
            </button>
          )}
        </div>
      ))}
      {others.length > 0 && (
        <>
          <h3>Operations you joined</h3>
          {others.map((op) => (
            <div key={op.id} className="request small">
              <OpHeader op={op} />
            </div>
          ))}
        </>
      )}

      <h3>Pact offers</h3>
      {offers.length === 0 && myOffers.length === 0 && <p className="muted small">None on the table.</p>}
      {offers.map((o) => (
        <div key={o.id} className="request small">
          <strong>{charLabel(game, o.from)}</strong> offers {PACT_LABEL[o.type].toLowerCase()}
          {o.region ? ` in ${content.regions.find((r) => r.id === o.region)?.name}` : ''}
          {o.route ? ` on ${content.routes.find((r) => r.id === o.route)?.name ?? o.route} (${Math.round(o.share * 100)}% to you)` : ''}
          {o.cash ? `, with ${money(o.cash)}` : ''}
          {o.days ? ` for ${o.days} days` : ''}. They think of you: <Opinion from={o.from} to={me} />
          <div className="actions">
            <button className="small" onClick={() => enqueue({ type: 'respond_pact', issuer: me, offer: o.id, accept: true })}>
              Accept
            </button>
            <button className="small" onClick={() => enqueue({ type: 'respond_pact', issuer: me, offer: o.id, accept: false })}>
              Refuse
            </button>
          </div>
        </div>
      ))}
      {myOffers.map((o) => (
        <p key={o.id} className="small muted">
          Waiting on {charLabel(game, o.to)}: {PACT_LABEL[o.type].toLowerCase()}.
        </p>
      ))}

      <h3>Your pacts</h3>
      {pacts.length === 0 && <p className="muted small">None.</p>}
      {pacts.map((p) => {
        const other = p.parties[0] === me ? p.parties[1] : p.parties[0];
        return (
          <div key={p.id} className="row small">
            <span>
              {PACT_LABEL[p.type]} with{' '}
              <button className="linkish" onClick={() => select({ kind: 'character', id: other })}>
                {charLabel(game, other)}
              </button>
              {p.region ? ` (${content.regions.find((r) => r.id === p.region)?.name})` : ''}
              {p.node ? ` (${name(p.node)})` : ''}
              {p.share ? `, ${Math.round(p.share * 100)}% ${p.parties[0] === me ? 'paid' : 'received'}` : ''}
              {p.secret ? ', secret' : ''}
              {p.expiresAt !== null ? `, until day ${Math.floor(p.expiresAt / 24)}` : ''}
            </span>
            {p.type !== 'income_share' && (
              <button className="small" title="Always possible, never free: they will remember" onClick={() => enqueue({ type: 'break_pact', issuer: me, pact: p.id })}>
                Break
              </button>
            )}
          </div>
        );
      })}

      <PactForm />
    </div>
  );
}

function OpHeader({ op }: { op: JointOp }) {
  const { content, game, select } = useGame();
  if (!game) return null;
  const name = content.nodes.find((n) => n.id === op.target)?.name ?? op.target;
  const status = op.status === 'planning' ? (game.hour >= op.strikeAt ? 'under way' : `strike ${formatDateTime(op.strikeAt, content.tuning)}`) : op.status === 'cancelled' ? 'called off' : (op.result ?? '');
  return (
    <div>
      <strong>{op.kind === 'attack' ? 'Attack on ' : 'Holding '}</strong>
      <button className="linkish" onClick={() => select({ kind: 'node', id: op.target })}>
        {name}
      </button>{' '}
      <span className="muted">
        led by {charLabel(game, op.proposer)} · {status}
        {op.kind === 'defend' && op.holdUntil ? ` until ${formatDateTime(op.holdUntil, content.tuning)}` : ''}
        {op.plaza !== 'contribution' && op.kind === 'attack' ? ` · plaza to ${op.plaza === 'proposer' ? charLabel(game, op.proposer) : charLabel(game, op.plaza)}` : op.kind === 'attack' ? ' · plaza by contribution' : ''}
        {op.leaked ? ' · leaked' : ''}
      </span>
    </div>
  );
}

function Invitation({ op }: { op: JointOp }) {
  const { content, game, enqueue } = useGame();
  const [crewsOn, setCrewsOn] = useState<Record<Id, boolean>>({});
  if (!game) return null;
  const me = game.playerId;
  const inv = op.invites.find((i) => i.to === me)!;
  const net = playerNetwork(game);
  const left = op.strikeAt - game.hour;
  const crews = Object.values(game.crews)
    .filter((c) => c.owner === me && c.battle === null && c.order.type !== 'escort' && !onDuty(game, c.id) && !onOperation(game, c.id))
    .map((c) => {
      const h =
        c.location.kind === 'node' && c.location.node === op.target
          ? 0
          : travelHours(game, content, { crews: groupOf(game, c), from: c.location, preference: 'fastest', departHour: game.hour, viewer: net, noPassThrough: rivalPlazaIds(game, net).filter((n) => n !== op.target) }).get(op.target);
      return { c, h };
    })
    .filter((x) => x.h !== undefined);
  const picked = crews.filter((x) => crewsOn[x.c.id]).map((x) => x.c.id);
  const committed = inv.crews.reduce((n, id) => n + (game.crews[id]?.men ?? 0), 0);
  return (
    <div className="request small">
      <OpHeader op={op} />
      <div>
        Offer to you: {inv.cash ? money(inv.cash) : 'no cash'}
        {inv.incomeShare ? `, ${Math.round(inv.incomeShare * 100)}% of the plaza's income for ${inv.incomeWeeks} weeks` : ''}
        {op.plaza === me ? ', and the plaza' : ''}.
      </div>
      {inv.status === 'pending' ? (
        <>
          {crews.length === 0 && <p className="muted">None of your crews can get there.</p>}
          {crews.map(({ c, h }) => (
            <label key={c.id} className="row">
              <input type="checkbox" checked={!!crewsOn[c.id]} onChange={(e) => setCrewsOn({ ...crewsOn, [c.id]: e.target.checked })} /> {charLabel(game, c.leader)} · {c.men} men{' '}
              <span className="muted">{h === 0 ? 'already there' : fmtHours(h!)}</span>
              {h! > left && <span className="error"> late</span>}
            </label>
          ))}
          <div className="actions">
            <button className="small" disabled={!picked.length} onClick={() => enqueue({ type: 'respond_operation', issuer: me, op: op.id, accept: true, crews: picked })}>
              Join with these crews
            </button>
            <button className="small" onClick={() => enqueue({ type: 'respond_operation', issuer: me, op: op.id, accept: false })}>
              Say no
            </button>
            <span className="muted">Saying no costs nothing.</span>
          </div>
        </>
      ) : (
        <div className="actions">
          <span className="pos">You are in with {committed} men.</span>
          {left > 0 && (
            <button className="small" title="Free before the strike" onClick={() => enqueue({ type: 'withdraw_operation', issuer: me, op: op.id })}>
              Back out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const PACT_TYPES: PactSpec['pact'][] = ['non_aggression', 'safe_passage', 'mutual_defense', 'local_truce', 'route_share'];
const PACT_HELP: Record<Exclude<PactType, 'income_share'>, string> = {
  non_aggression: 'Neither of you attacks the other. Secret across faction lines; if it comes out, your head will not like it.',
  safe_passage: 'Your crews pass each other without being stopped. Attacks on plazas still allowed.',
  mutual_defense: 'When either of you is attacked, the other is called and expected to come. Your own side only.',
  local_truce: 'No fighting between you two in one region for a while.',
  route_share: 'You pay them a share of what you earn on one route.',
};

function PactForm() {
  const { content, game, enqueue } = useGame();
  const [to, setTo] = useState<Id>('');
  const [type, setType] = useState<PactSpec['pact']>('non_aggression');
  const [region, setRegion] = useState<Id>(content.regions[0]!.id);
  const [route, setRoute] = useState<Id>(content.routes[0]!.id);
  const [share, setShare] = useState(0.2);
  const [cash, setCash] = useState(0);
  const [days, setDays] = useState(30);
  if (!game) return null;
  const me = game.playerId;
  const people = Object.values(game.characters)
    .filter((c) => c.id !== me && c.status === 'free')
    .sort((a, b) => (a.faction ?? 'zz').localeCompare(b.faction ?? 'zz') || (a.alias ?? a.name).localeCompare(b.alias ?? b.name));
  const spec: PactSpec = { to, pact: type, region, route, share, cash, days };
  const blocked = to ? pactBlocked(game, content, me, spec) : 'pick someone';
  const factionName = (f: Id | null) => (f ? (content.factions.find((x) => x.id === f)?.name ?? f) : 'Neutral');
  return (
    <>
      <h3>Offer a pact</h3>
      <div className="actions small">
        <select id="pact-to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="With">
          <option value="">With…</option>
          {people.map((c) => (
            <option key={c.id} value={c.id}>
              {c.alias ?? c.name} ({factionName(c.faction)})
            </option>
          ))}
        </select>
        <select id="pact-type" value={type} onChange={(e) => setType(e.target.value as PactSpec['pact'])} aria-label="Pact">
          {PACT_TYPES.map((p) => (
            <option key={p} value={p}>
              {PACT_LABEL[p]}
            </option>
          ))}
        </select>
        {type === 'local_truce' && (
          <select id="pact-region" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region">
            {content.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        {type === 'route_share' && (
          <>
            <select id="pact-route" value={route} onChange={(e) => setRoute(e.target.value)} aria-label="Route">
              {content.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select id="pact-share" value={share} onChange={(e) => setShare(Number(e.target.value))} aria-label="Share">
              {[0.1, 0.2, 0.3, 0.4, 0.5].map((x) => (
                <option key={x} value={x}>
                  {Math.round(x * 100)}%
                </option>
              ))}
            </select>
          </>
        )}
        <label>
          Cash <input id="pact-cash" type="number" min={0} step={10000} value={cash} onChange={(e) => setCash(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label>
          Days{' '}
          <select id="pact-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[14, 30, 60, 90, 0].map((d) => (
              <option key={d} value={d}>
                {d === 0 ? 'until broken' : d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small">{PACT_HELP[type]}</p>
      <button className="small" disabled={blocked !== null} title={blocked ?? ''} onClick={() => enqueue({ type: 'propose_pact', issuer: me, ...spec })}>
        Offer
      </button>
      {blocked && to && <span className="muted small"> {blocked}</span>}
    </>
  );
}
