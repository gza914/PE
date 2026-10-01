import { useState } from 'react';
import { associateOf, askLabel, askPrice, cartelName, contactVia, dealBlocked, NO_OFFER, offerValue, OUTSIDE_TIERS, outsideCartels, tierName } from '../../sim/outside';
import { cashOf } from '../../sim/money';
import { gearName } from '../../sim/forces';
import type { Id, OutsideAsk, OutsideOffer, OutsideTier } from '../../sim/state';
import { useGame } from '../store';
import { charLabel } from '../util';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function mood(a: number): string {
  if (a <= -40) return 'hostile';
  if (a < 0) return 'cold';
  if (a < 10) return 'businesslike';
  if (a < 30) return 'friendly';
  return 'close';
}

function hunger(a: number): string {
  if (a < 25) return 'content';
  if (a < 50) return 'watching';
  if (a < 75) return 'restless';
  return 'hungry';
}

/** Outside cartels: relationship, ambition, contingents, and the negotiation menu. */
export function OutsidePanel() {
  const { content, game } = useGame();
  if (!game) return null;
  return (
    <div className="outside">
      <p className="muted small">
        Only faction heads and you deal with them. Their men stay theirs: you command them, but they answer to their cartel, cost a weekly retainer, and go home if you die. A plaza given to them makes them an associate of your
        side.
      </p>
      {outsideCartels(content).map((c) => (
        <Cartel key={c} cartel={c} />
      ))}
    </div>
  );
}

function Cartel({ cartel }: { cartel: Id }) {
  const { content, game, select } = useGame();
  const [open, setOpen] = useState(false);
  if (!game) return null;
  const me = game.playerId;
  const o = game.outsiders[cartel]!;
  const def = content.factions.find((f) => f.id === cartel)!;
  const head = def.head!;
  const via = contactVia(game, content, me, cartel);
  const partner = associateOf(game, cartel);
  const plazas = content.nodes.filter((n) => game.nodes[n.id]!.owner === head);
  const lent = Object.values(game.crews).filter((c) => c.hired?.kind === 'contingent' && c.hired.from === cartel);
  const deals = game.outsideDeals.filter((d) => d.cartel === cartel && d.client === me);
  const openDeal = deals.find((d) => d.status === 'open');
  return (
    <div className="cartel">
      <h3 style={{ color: def.color }}>{def.name}</h3>
      <p className="muted small">{def.description}</p>
      <dl className="small">
        <dt>Toward you</dt>
        <dd>
          {mood(o.attitude[me] ?? 0)}
          {o.hostile.includes(me) && ' · they are coming for you'}
        </dd>
        <dt>Ambition</dt>
        <dd>{o.declared ? 'declared for themselves' : hunger(o.ambition)}</dd>
        <dt>Stands with</dt>
        <dd>{partner ? content.factions.find((f) => f.id === partner)?.name : o.declared ? 'no one' : 'no one yet'}</dd>
        <dt>Plazas</dt>
        <dd>
          {plazas.length
            ? plazas.map((p) => (
                <button key={p.id} className="linkish" onClick={() => select({ kind: 'node', id: p.id })}>
                  {p.name}{' '}
                </button>
              ))
            : 'none'}
        </dd>
        <dt>Men lent out</dt>
        <dd>{lent.length ? lent.map((c) => `${c.men} to ${charLabel(game, c.owner)}`).join(', ') : 'none'}</dd>
        <dt>Contact</dt>
        <dd>{via ?? 'none: hold a port or a border road, or wait for an envoy'}</dd>
        {o.promises.some((p) => p.by === me) && (
          <>
            <dt>You promised</dt>
            <dd>{o.promises.filter((p) => p.by === me).map((p) => `${content.nodes.find((n) => n.id === p.node)?.name} by day ${Math.floor(p.dueAt / 24)}`).join(', ')}</dd>
          </>
        )}
        {o.loans.some((l) => l.by === me) && (
          <>
            <dt>You owe</dt>
            <dd>{o.loans.filter((l) => l.by === me).map((l) => `${money(l.owed)} by day ${Math.floor(l.dueAt / 24)}`).join(', ')}</dd>
          </>
        )}
      </dl>
      {openDeal && <OpenDeal id={openDeal.id} />}
      {deals
        .filter((d) => d.status !== 'open')
        .slice(-2)
        .map((d) => (
          <p key={d.id} className="muted small">
            {d.status === 'agreed' ? 'Agreed' : 'No deal'}: {askLabel(game, content, d.ask)}
            {d.reason ? ` (${d.reason})` : ''}
          </p>
        ))}
      {!openDeal && via && (
        <button className="linkish" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Make them an offer
        </button>
      )}
      {!openDeal && via && open && <DealForm cartel={cartel} onDone={() => setOpen(false)} />}
      {head && <span className="muted small"> Their man: {charLabel(game, head)}</span>}
    </div>
  );
}

function OpenDeal({ id }: { id: Id }) {
  const { content, game, enqueue } = useGame();
  if (!game) return null;
  const d = game.outsideDeals.find((x) => x.id === id)!;
  return (
    <div className="request small">
      <div>
        On the table: {askLabel(game, content, d.ask)} · round {d.round} of {content.tuning.outside.maxRounds}
      </div>
      {d.counter && <div className="pos">Their counter: {d.reason}.</div>}
      <div className="actions">
        {d.counter && (
          <button className="small" onClick={() => enqueue({ type: 'outside_accept', issuer: game.playerId, deal: d.id })}>
            Take it
          </button>
        )}
        <button className="small" onClick={() => enqueue({ type: 'outside_walk', issuer: game.playerId, deal: d.id })}>
          Walk away
        </button>
      </div>
      <p className="muted small">Or make a new offer below for the next round.</p>
      <DealForm cartel={d.cartel} deal={d.id} initialAsk={d.ask} />
    </div>
  );
}

function DealForm({ cartel, deal, initialAsk, onDone }: { cartel: Id; deal?: Id; initialAsk?: OutsideAsk; onDone?: () => void }) {
  const { content, game, enqueue } = useGame();
  const me = game?.playerId ?? '';
  const myPlazas = game ? content.nodes.filter((n) => game.nodes[n.id]!.owner === me && n.id !== content.culiacan.parentNode) : [];
  const myCrews = game ? Object.values(game.crews).filter((c) => c.owner === me) : [];
  const [kind, setKind] = useState<OutsideAsk['kind']>(initialAsk?.kind ?? 'men');
  const [tier, setTier] = useState<OutsideTier>(initialAsk?.kind === 'men' ? initialAsk.tier : 'sicarios');
  const [men, setMen] = useState(initialAsk?.kind === 'men' ? initialAsk.men : 12);
  const [node, setNode] = useState(initialAsk?.kind === 'men' ? initialAsk.node : (myPlazas[0]?.id ?? ''));
  const [crew, setCrew] = useState(initialAsk && 'crew' in initialAsk ? initialAsk.crew : (myCrews[0]?.id ?? ''));
  const [gear, setGear] = useState(initialAsk?.kind === 'weapons' ? initialAsk.gear : 4);
  const [count, setCount] = useState(1);
  const [loan, setLoan] = useState(100000);
  const [offer, setOffer] = useState<OutsideOffer>({ ...NO_OFFER });
  if (!game) return null;
  const c = content.tuning.outside.cartels[cartel]!;
  const ask: OutsideAsk = kind === 'men' ? { kind, tier, men, node } : kind === 'weapons' ? { kind, crew, gear } : kind === 'armored' ? { kind, crew, count } : { kind, amount: loan };
  const fresh = askPrice(game, content, cartel, me, ask);
  const current = deal ? game.outsideDeals.find((d) => d.id === deal)?.price : undefined;
  const price = { ...fresh, upfront: current !== undefined ? Math.min(current, fresh.upfront) : fresh.upfront };
  const value = offerValue(game, content, cartel, me, offer);
  const blocked = dealBlocked(game, content, me, { cartel, ask, offer, deal: deal ?? null });
  const set = (p: Partial<OutsideOffer>) => setOffer({ ...offer, ...p });
  return (
    <div className="dealform small">
      <div className="row">
        Ask for{' '}
        <select value={kind} onChange={(e) => setKind(e.target.value as OutsideAsk['kind'])}>
          <option value="men">men</option>
          <option value="weapons">weapons</option>
          <option value="armored">armored trucks</option>
          <option value="loan">a loan</option>
        </select>
      </div>
      {kind === 'men' && (
        <div className="row">
          <input type="number" min={4} max={c.tiers[tier]!.maxMen} value={men} onChange={(e) => setMen(Number(e.target.value))} />
          <select value={tier} onChange={(e) => setTier(e.target.value as OutsideTier)}>
            {OUTSIDE_TIERS.map((x) => (
              <option key={x} value={x}>
                {tierName(content, x)} (up to {c.tiers[x]!.maxMen}, {money(c.tiers[x]!.pricePerMan)} a man, {money(c.tiers[x]!.weeklyPerMan)}/wk)
              </option>
            ))}
          </select>
          to
          <select value={node} onChange={(e) => setNode(e.target.value)}>
            {myPlazas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {(kind === 'weapons' || kind === 'armored') && (
        <div className="row">
          for
          <select value={crew} onChange={(e) => setCrew(e.target.value)}>
            {myCrews.map((x) => (
              <option key={x.id} value={x.id}>
                {charLabel(game, x.leader)} · {x.men} men · {gearName(content.tuning, x.gear)}
              </option>
            ))}
          </select>
          {kind === 'weapons' ? (
            <select value={gear} onChange={(e) => setGear(Number(e.target.value))}>
              {[2, 3, 4, 5].map((g) => (
                <option key={g} value={g}>
                  {gearName(content.tuning, g)}
                </option>
              ))}
            </select>
          ) : (
            <input type="number" min={1} max={c.armoredMax} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          )}
        </div>
      )}
      {kind === 'loan' && (
        <div className="row">
          <input type="number" min={0} step={10000} value={loan} onChange={(e) => setLoan(Number(e.target.value))} /> paid back with {Math.round(content.tuning.outside.loan.interest * 100)}% on top in {content.tuning.outside.loan.weeks} weeks
        </div>
      )}
      {kind !== 'loan' && (
        <>
          <div className="row">
            Offer cash <input type="number" min={0} step={5000} value={offer.cash} onChange={(e) => set({ cash: Math.max(0, Number(e.target.value) || 0) })} />
            <span className="muted">of {money(cashOf(game, me))}</span>
          </div>
          <div className="row">
            Retainer <input type="number" min={0} step={1000} value={offer.retainer} onChange={(e) => set({ retainer: Math.max(0, Number(e.target.value) || 0) })} />
            /wk for <input type="number" min={0} max={52} value={offer.retainerWeeks} onChange={(e) => set({ retainerWeeks: Math.max(0, Number(e.target.value) || 0) })} /> weeks
          </div>
          <div className="row">
            Income share
            <select value={offer.incomeShare} onChange={(e) => set({ incomeShare: Number(e.target.value) })}>
              {[0, 0.05, 0.1, 0.2, 0.3].map((x) => (
                <option key={x} value={x}>
                  {Math.round(x * 100)}%
                </option>
              ))}
            </select>
            for <input type="number" min={0} max={52} value={offer.incomeWeeks} onChange={(e) => set({ incomeWeeks: Math.max(0, Number(e.target.value) || 0) })} /> weeks
          </div>
          <div className="row">
            Plaza now
            <select value={offer.plazaNow ?? ''} onChange={(e) => set({ plazaNow: e.target.value || null })}>
              <option value="">none</option>
              {myPlazas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            later
            <select value={offer.plazaLater ?? ''} onChange={(e) => set({ plazaLater: e.target.value || null })}>
              <option value="">none</option>
              {myPlazas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <p className="muted">
        {kind === 'loan' ? 'They lend if they trust you.' : `They want about ${money(price.upfront)}${price.weekly ? `, then ${money(price.weekly)}/week for the men` : ''}. Your offer is worth about ${money(value)} to them.`}
      </p>
      <button
        className="small"
        disabled={!!blocked}
        title={blocked ?? ''}
        onClick={() => {
          enqueue({ type: 'outside_deal', issuer: me, cartel, ask, offer, deal: deal ?? null });
          onDone?.();
        }}
      >
        {deal ? 'Make the new offer' : `Offer it to ${cartelName(content, cartel)}`}
      </button>
      {blocked && <span className="error"> {blocked}</span>}
    </div>
  );
}
