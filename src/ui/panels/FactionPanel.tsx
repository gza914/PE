import { formatDateTime } from '../../sim/clock';
import { newContext } from '../../sim/context';
import { networkOf } from '../../sim/network';
import { opinionBreakdown, opinionOf } from '../../sim/opinion';
import { describeRequest } from '../../sim/requests';
import type { FactionRequest, WarPlanReason } from '../../sim/state';
import { territoryShares } from '../../sim/systems/economy';
import { world } from '../../sim/world';
import { useGame } from '../store';
import { charLabel } from '../util';

const REASON: Record<WarPlanReason, string> = {
  opening: 'Getting organized; no big moves in the opening days.',
  exhausted: 'Bled white: every offensive halts while the men recover.',
  threatened: 'Enemy crews are near one of our plazas; defending first.',
  tired: 'Too worn down for a major offensive.',
  low_supply: 'Short on money, men, and ammunition for an offensive.',
  cooldown: 'Regrouping after the last offensive.',
  busy: 'An offensive is under way.',
  no_target: 'No rival plaza we could take with the force at hand.',
  attacking: 'On the attack.',
  player: 'Your call: you lead the faction.',
};

const OPINION_LABEL: Record<string, string> = {
  same_faction: 'Same faction',
  relation_parent: 'Family',
  relation_child: 'Family',
  relation_sibling: 'Family',
  relation_spouse: 'Married',
  relation_compadre: 'Compadres',
  relation_rival: 'Rivals',
  relation_vendetta: 'Vendetta',
  kept_their_word: 'Kept their word',
  failed_a_request: 'Did not deliver',
  refused_a_request: 'Refused a request',
  ignored_a_request: 'Ignored a request',
  shared_a_victory: 'Shared a victory',
  paid_late: 'Paid late',
  starting_lean: 'Old loyalties',
};

function Opinion({ from, to }: { from: string; to: string }) {
  const { content, game } = useGame();
  if (!game) return null;
  const lines = opinionBreakdown(game, content, from, to);
  const v = Math.round(opinionOf(game, content, from, to));
  const title = lines.map((l) => `${OPINION_LABEL[l.key] ?? l.key}: ${l.value > 0 ? '+' : ''}${Math.round(l.value)}`).join('\n') || 'No history';
  return (
    <span className={`opinion ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`} title={title}>
      {v > 0 ? '+' : ''}
      {v}
    </span>
  );
}

export function FactionPanel() {
  const { content, game, enqueue, queue } = useGame();
  if (!game) return null;
  const me = game.characters[game.playerId]!;
  const w = world(content);
  const shares = territoryShares(game, content);
  const majors = content.factions.filter((f) => f.kind === 'major');
  const fs = me.faction ? game.factions[me.faction] : undefined;
  const head = fs?.head ? game.characters[fs.head] : undefined;
  const iAmHead = fs?.head === me.id;
  const offensive = game.offensives.find((o) => o.faction === me.faction && (o.status === 'gathering' || o.status === 'assault'));
  const pending = game.requests.filter((r) => r.to === me.id && r.status === 'pending');
  const recent = game.requests.filter((r) => r.to === me.id && r.status !== 'pending').slice(-5).reverse();
  const queued = (r: FactionRequest) => queue.some((q) => q.type === 'respond_request' && q.request === r.id);
  const ctx = newContext(game, content);
  const place = (id: string | null) => (id ? (content.nodes.some((n) => n.id === id) ? w.node(id).name : (content.culiacan.colonias.find((c) => c.id === id)?.name ?? id)) : '');

  const acceptAndSend = (r: FactionRequest) => {
    enqueue({ type: 'respond_request', issuer: me.id, request: r.id, accept: true });
    for (const id of r.crews) {
      const c = game.crews[id];
      if (!c || c.owner !== me.id || c.battle !== null || !r.target) continue;
      if (r.kind === 'join_offensive') enqueue({ type: 'order_crew', issuer: me.id, crew: id, order: { type: 'raid', target: r.target, preference: 'fastest', arriveAt: r.arriveBy, avoidRivalPlazas: true } });
      if (r.kind === 'defend') enqueue({ type: 'order_crew', issuer: me.id, crew: id, order: { type: 'move', destination: r.target, preference: 'fastest', avoidRivalPlazas: true } });
      if (r.kind === 'hold_colonia') enqueue({ type: 'order_crew', issuer: me.id, crew: id, order: { type: 'move', destination: content.culiacan.parentNode, preference: 'fastest', avoidRivalPlazas: true } });
    }
  };

  return (
    <div className="factionpanel">
      <h3>The map</h3>
      <div className="sharebar" title="Share of all plaza value held">
        {majors.map((f) => (
          <div key={f.id} style={{ width: `${(shares.get(f.id) ?? 0) * 100}%`, background: f.color }} />
        ))}
      </div>
      <p className="small mono">
        {majors.map((f) => `${f.name} ${Math.round((shares.get(f.id) ?? 0) * 100)}%`).join(' · ')} · a side under {Math.round(content.tuning.endings.territorialDefeatShare * 100)}% for{' '}
        {content.tuning.endings.territorialDefeatDays} days loses
      </p>

      {!fs ? (
        <>
          <h3>You are neutral</h3>
          <p className="small muted">You keep all your income and collect tolls from both sides, but nobody will come to help you, and later in the war your plazas become fair game.</p>
          <div className="btns">
            {majors.map((f) => (
              <button key={f.id} onClick={() => enqueue({ type: 'declare_alignment', issuer: me.id, faction: f.id })}>
                Declare for the {f.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <h3>{content.factions.find((f) => f.id === me.faction)?.name}</h3>
          <dl className="small">
            <dt>Head</dt>
            <dd>{iAmHead ? 'You' : head ? charLabel(game, head.id) : 'Nobody'}</dd>
            <dt>Supply</dt>
            <dd>{Math.round(fs.supply)}</dd>
            <dt>Exhaustion</dt>
            <dd className={fs.exhaustion >= content.tuning.pulse.aiNoMajorOffensiveAboveExhaustion ? 'error' : ''}>{Math.round(fs.exhaustion)}</dd>
            <dt>Plan</dt>
            <dd>
              {fs.warPlan.mode}
              {fs.warPlan.target && ` · ${place(fs.warPlan.target)}`}
            </dd>
          </dl>
          <p className="small muted">{iAmHead ? REASON.player : REASON[fs.warPlan.reason]}</p>
          {offensive && (
            <p className="small">
              Offensive on <strong>{place(offensive.target)}</strong> ({offensive.status}), hitting {formatDateTime(offensive.arriveAt, content.tuning)}.
            </p>
          )}
          {head && !iAmHead && (
            <p className="small">
              {charLabel(game, head.id)} thinks of you: <Opinion from={head.id} to={me.id} /> · you of them: <Opinion from={me.id} to={head.id} />
            </p>
          )}
          {game.truceOffered && iAmHead && (
            <button onClick={() => enqueue({ type: 'accept_truce', issuer: me.id })}>Accept the truce and end the war</button>
          )}
        </>
      )}

      <h3>Requests to you</h3>
      {pending.length === 0 && <p className="muted small">None right now.</p>}
      {pending.map((r) => (
        <div key={r.id} className="request">
          <p className="small">
            <strong>{charLabel(game, r.from)}</strong> asks you to {describeRequest(ctx, r)}
            {r.arriveBy !== null && `, by ${formatDateTime(r.arriveBy, content.tuning)}`}.
          </p>
          <p className="muted small">Answer by {formatDateTime(r.respondBy, content.tuning)}. Refusing or ignoring costs their good opinion.</p>
          <div className="btns">
            {r.kind !== 'levy' && r.crews.some((id) => game.crews[id]?.owner === me.id) && (
              <button className="small" disabled={queued(r)} onClick={() => acceptAndSend(r)}>
                Accept and send the crews
              </button>
            )}
            <button className="small" disabled={queued(r)} onClick={() => enqueue({ type: 'respond_request', issuer: me.id, request: r.id, accept: true })}>
              {r.kind === 'levy' ? 'Pay' : 'Accept'}
            </button>
            <button className="small" disabled={queued(r)} onClick={() => enqueue({ type: 'respond_request', issuer: me.id, request: r.id, accept: false })}>
              Refuse
            </button>
          </div>
        </div>
      ))}
      {recent.length > 0 && (
        <>
          <h3>Earlier</h3>
          <ul className="small plain">
            {recent.map((r) => (
              <li key={r.id} className="muted">
                {describeRequest(ctx, r)}: {r.status}
              </li>
            ))}
          </ul>
        </>
      )}
      {networkOf(game, me.id) === me.id && fs && null}
    </div>
  );
}
