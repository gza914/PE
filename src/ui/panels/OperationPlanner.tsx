import { useMemo, useState } from 'react';
import { rivalPlazaIds } from '../../sim/commands';
import { groupOf } from '../../sim/crews';
import { onOperation } from '../../sim/operations';
import { onDuty } from '../../sim/requests';
import { travelHours } from '../../sim/routing';
import type { CrewState, Id, OpKind } from '../../sim/state';
import { useGame } from '../store';
import { charLabel, crewLabel, fmtHours, playerNetwork } from '../util';

interface InviteDraft {
  on: boolean;
  cash: number;
  share: number;
  weeks: number;
}

/**
 * Plan a joint operation: pick your crews, the bosses to invite and what to
 * offer each, who gets the plaza, and when everyone arrives. Invitees answer
 * in their own time; refusing costs them nothing.
 */
export function OperationPlanner({ kind, target }: { kind: OpKind; target: Id }) {
  const { content, game, enqueue, select } = useGame();
  const [crewsOn, setCrewsOn] = useState<Record<Id, boolean>>({});
  const [invites, setInvites] = useState<Record<Id, InviteDraft>>({});
  const [plaza, setPlaza] = useState<string>('contribution');
  const [lead, setLead] = useState<number | null>(null);
  const [hold, setHold] = useState(24);
  const t = content.tuning.coalition;

  const data = useMemo(() => {
    if (!game) return null;
    const net = playerNetwork(game);
    const me = game.characters[game.playerId]!;
    const eta = (c: CrewState): number | null => {
      if (c.location.kind === 'node' && c.location.node === target) return 0;
      const h = travelHours(game, content, { crews: groupOf(game, c), from: c.location, preference: 'fastest', departHour: game.hour, viewer: net, noPassThrough: rivalPlazaIds(game, net).filter((n) => n !== target) }).get(target);
      return h ?? null;
    };
    const usable = (c: CrewState) => c.battle === null && c.order.type !== 'escort' && !onDuty(game, c.id) && !onOperation(game, c.id);
    const mine = Object.values(game.crews)
      .filter((c) => c.owner === game.playerId && usable(c))
      .map((c) => ({ c, h: eta(c) }))
      .filter((x) => x.h !== null)
      .sort((a, b) => a.h! - b.h!);
    const allies = Object.values(game.characters)
      .filter((ch) => ch.id !== me.id && ch.faction !== null && ch.faction === me.faction && ch.status === 'free')
      .map((ch) => {
        const near = Object.values(game.crews)
          .filter((c) => c.owner === ch.id && usable(c) && c.location.kind === 'node')
          .map((c) => ({ c, h: eta(c) }))
          .filter((x) => x.h !== null && x.h <= t.inviteMaxTravelHours);
        return { ch, men: near.reduce((n, x) => n + x.c.men, 0), h: near.length ? Math.min(...near.map((x) => x.h!)) : null };
      })
      .sort((a, b) => b.men - a.men || (a.ch.id < b.ch.id ? -1 : 1));
    return { mine, allies };
  }, [game, content, target, t.inviteMaxTravelHours]);

  if (!game || !data) return null;
  const w = content.nodes.find((n) => n.id === target)!;
  const chosen = data.mine.filter((x) => crewsOn[x.c.id]);
  const slowest = chosen.length ? Math.max(...chosen.map((x) => x.h!)) : 0;
  const strikeIn = lead ?? Math.max(t.minLeadHours, Math.ceil(slowest) + 2, kind === 'attack' ? 6 : 3);
  const invited = Object.entries(invites).filter(([, d]) => d.on);
  const leadOptions = [...new Set([strikeIn, 3, 6, 12, 18, 24, 36, 48, 72].filter((h) => h >= t.minLeadHours && h <= t.maxLeadHours))].sort((a, b) => a - b);
  const submit = () => {
    enqueue({
      type: 'propose_operation',
      issuer: game.playerId,
      kind,
      target,
      strikeAt: game.hour + strikeIn,
      holdUntil: kind === 'defend' ? game.hour + strikeIn + hold : null,
      plaza: plaza === 'me' ? 'proposer' : plaza,
      crews: chosen.map((x) => x.c.id),
      invites: invited.map(([to, d]) => ({ to, cash: d.cash, incomeShare: d.share, incomeWeeks: d.weeks })),
    });
    select({ kind: 'node', id: target });
  };
  const draft = (id: Id): InviteDraft => invites[id] ?? { on: false, cash: 0, share: 0, weeks: 4 };
  const setDraft = (id: Id, patch: Partial<InviteDraft>) => setInvites({ ...invites, [id]: { ...draft(id), ...patch } });

  return (
    <div className="opplanner">
      <h2>{kind === 'attack' ? `Joint attack on ${w.name}` : `Hold ${w.name} together`}</h2>
      <p className="muted small">
        {kind === 'attack'
          ? 'Everyone arrives at the strike hour. Invitees decide for themselves; saying no costs them nothing, but agreeing and not showing up is remembered.'
          : 'Allies bring crews and hold the plaza with you until the end. Free to refuse.'}
      </p>

      <h3>When</h3>
      <div className="actions">
        <label>
          Everyone there in{' '}
          <select id="op-lead" value={strikeIn} onChange={(e) => setLead(Number(e.target.value))}>
            {leadOptions.map((h) => (
              <option key={h} value={h}>
                {h}h{h === Math.ceil(slowest) + 2 ? ' (your slowest crew)' : ''}
              </option>
            ))}
          </select>
        </label>
        {kind === 'defend' && (
          <label>
            Hold for{' '}
            <select id="op-hold" value={hold} onChange={(e) => setHold(Number(e.target.value))}>
              {[12, 24, 48, 72, 120].map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <h3>Your crews</h3>
      {data.mine.length === 0 && <p className="muted small">None of your crews can get there.</p>}
      {data.mine.map(({ c, h }) => (
        <label key={c.id} className="row small">
          <input type="checkbox" checked={!!crewsOn[c.id]} onChange={(e) => setCrewsOn({ ...crewsOn, [c.id]: e.target.checked })} /> {crewLabel(game, c)}{' '}
          <span className="muted">{h === 0 ? 'already there' : fmtHours(h!)}</span>
          {h! > strikeIn && <span className="error"> late</span>}
        </label>
      ))}

      <h3>Invite</h3>
      {data.allies.length === 0 && <p className="muted small">No one on your side to ask.</p>}
      {data.allies.map(({ ch, men, h }) => {
        const d = draft(ch.id);
        return (
          <div key={ch.id} className="invite small">
            <label className="row">
              <input type="checkbox" checked={d.on} disabled={!d.on && invited.length >= t.maxInvites} onChange={(e) => setDraft(ch.id, { on: e.target.checked })} />{' '}
              <button className="linkish" onClick={() => select({ kind: 'character', id: ch.id })}>
                {charLabel(game, ch.id)}
              </button>
              <span className="muted">{men ? `~${men} men within reach (${fmtHours(h!)})` : 'no crews within reach'}</span>
            </label>
            {d.on && (
              <div className="actions">
                <label>
                  Cash{' '}
                  <input id={`op-cash-${ch.id}`} type="number" min={0} step={5000} value={d.cash} onChange={(e) => setDraft(ch.id, { cash: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                {kind === 'attack' && (
                  <label>
                    Income share{' '}
                    <select id={`op-share-${ch.id}`} value={d.share} onChange={(e) => setDraft(ch.id, { share: Number(e.target.value) })}>
                      {[0, 0.1, 0.2, 0.3].map((x) => (
                        <option key={x} value={x}>
                          {Math.round(x * 100)}%
                        </option>
                      ))}
                    </select>{' '}
                    for{' '}
                    <select id={`op-weeks-${ch.id}`} value={d.weeks} onChange={(e) => setDraft(ch.id, { weeks: Number(e.target.value) })}>
                      {[2, 4, 8].map((x) => (
                        <option key={x} value={x}>
                          {x} weeks
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        );
      })}

      {kind === 'attack' && (
        <>
          <h3>Who gets {w.name}</h3>
          <select id="op-plaza" value={plaza} onChange={(e) => setPlaza(e.target.value)}>
            <option value="contribution">Whoever contributes most (men who fought; losses count double)</option>
            <option value="me">You</option>
            {invited.map(([to]) => (
              <option key={to} value={to}>
                {charLabel(game, to)}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="actions">
        <button disabled={!invited.length} onClick={submit}>
          Send the proposal
        </button>
        <button onClick={() => select({ kind: 'node', id: target })}>Cancel</button>
      </div>
      {!invited.length && <p className="muted small">Invite at least one boss.</p>}
    </div>
  );
}
