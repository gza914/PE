import { useState } from 'react';
import { dayOf, hourOfDay, weekday } from '../../sim/clock';
import { cashOf, ledgerTotals, stashesOf } from '../../sim/money';
import type { CostStream, IncomeStream, LedgerDay } from '../../sim/state';
import { dailyIncome, halconesDue, payrollDue } from '../../sim/systems/economy';
import { world } from '../../sim/world';
import { useGame } from '../store';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const INCOME_LABEL: Record<IncomeStream, string> = {
  trafficking: 'Trafficking',
  tolls: 'Tolls',
  extortion: 'Extortion',
  labs: 'Labs',
  rackets: 'Rackets',
  tribute: 'Tribute received',
  aid: 'Faction aid',
  ransom: 'Ransoms',
  deals: 'Deals',
};
const COST_LABEL: Record<CostStream, string> = {
  payroll: 'Payroll',
  halcones: 'Halcones',
  tribute: 'Tribute paid',
  aid: 'Aid sent',
  ammo: 'Ammunition',
  vehicles: 'Vehicles',
  recruits: 'Recruits',
  drones: 'Drones',
  informants: 'Informants',
  ransom: 'Ransoms',
  bribes: 'Bribes',
  messages: 'Messages',
  schemes: 'Schemes',
  seized: 'Seized by the State',
  deals: 'Deals',
  foreign: 'Outside partners',
};
const total = (o: Partial<Record<string, number>>) => Object.values(o).reduce<number>((n, v) => n + (v ?? 0), 0);

/** Last 14 days of income vs costs: grouped bars, one axis, legend + hover readout. */
function LedgerChart({ days }: { days: LedgerDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  if (!days.length) return <p className="muted small">No days settled yet.</p>;
  const W = 280;
  const H = 110;
  const pad = { l: 4, r: 4, t: 6, b: 16 };
  const max = Math.max(1, ...days.flatMap((d) => [total(d.income), total(d.costs)]));
  const slot = (W - pad.l - pad.r) / 14;
  const bw = Math.max(3, (slot - 6) / 2);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const base = H - pad.b;
  const shown = hover !== null ? days[hover] : days[days.length - 1];
  // Rounded data-end, square at the baseline.
  const bar = (x: number, v: number) => {
    const top = y(v);
    const h = base - top;
    if (h <= 0) return '';
    const r = Math.min(3, h, bw / 2);
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`;
  };
  return (
    <div className="ledgerchart">
      <div className="legend small">
        <span>
          <i className="sw income" /> Income
        </span>
        <span>
          <i className="sw costs" /> Costs
        </span>
        <button className="linkish small" onClick={() => setTable(!table)}>
          {table ? 'Chart' : 'Table'}
        </button>
      </div>
      {shown && (
        <p className="mono small readout">
          Day {shown.day}: in {money(total(shown.income))} · out {money(total(shown.costs))}
        </p>
      )}
      {table ? (
        <table className="small mono">
          <thead>
            <tr>
              <th>Day</th>
              <th>Income</th>
              <th>Costs</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{money(total(d.income))}</td>
                <td>{money(total(d.costs))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Income and costs by day" onMouseLeave={() => setHover(null)}>
          <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} className="axis" />
          {days.map((d, i) => {
            const x = pad.l + i * slot + 2;
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)}>
                <rect x={x - 2} y={pad.t} width={slot} height={H - pad.t} className="hit" />
                <path d={bar(x, total(d.income))} className="income" />
                <path d={bar(x + bw + 2, total(d.costs))} className="costs" />
                {(i === 0 || i === days.length - 1) && (
                  <text x={x + bw} y={H - 4} textAnchor="middle" className="tick">
                    {d.day}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

export function EconomyPanel() {
  const { content, game, enqueue, queue } = useGame();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState(50000);
  if (!game) return null;
  const me = game.characters[game.playerId]!;
  const w = world(content);
  const e = content.tuning.economy;
  const cash = cashOf(game, me.id);
  const payroll = payrollDue(game, content, me.id);
  const halcones = halconesDue(game, content, me.id);
  const forecast = dailyIncome(game, content).filter((l) => l.recipient === me.id);
  const perDay = forecast.reduce((n, l) => n + l.amount, 0);
  const tribute = me.faction && game.factions[me.faction]?.head !== me.id ? perDay * e.factionTributeRate : 0;
  const weekNet = (perDay - tribute) * 7 - payroll - halcones;
  const byStream = new Map<IncomeStream, number>();
  for (const l of forecast) byStream.set(l.stream, (byStream.get(l.stream) ?? 0) + l.amount);
  const clock = content.tuning.clock;
  const hoursToPay = ((clock.payrollWeekday - weekday(game.hour, content.tuning) + 7) % 7) * 24 + clock.payrollHour - hourOfDay(game.hour);
  const untilPay = hoursToPay <= 0 ? hoursToPay + 7 * 24 : hoursToPay;
  const week = ledgerTotals(game, me.id, 7);
  const last = me.ledger.at(-1);
  const stashes = stashesOf(game, me.id);
  const head = me.faction ? game.factions[me.faction]?.head : null;
  const aidReady = me.lastAidAt === null || game.hour - me.lastAidAt >= e.aid.cooldownDays * 24;

  return (
    <div className="economy">
      <p className="bigcash mono">{money(cash)}</p>
      <p className="muted small">
        {stashes.length} stash house{stashes.length === 1 ? '' : 's'}
        {me.purse > 0 && ` · ${money(me.purse)} carried`}
      </p>
      {me.missedPayrollWeeks > 0 && (
        <p className="error small">
          Payroll missed {me.missedPayrollWeeks} week{me.missedPayrollWeeks > 1 ? 's' : ''} running.
          {me.missedPayrollWeeks >= e.missedPayroll.consecutiveWeeksForDesertion ? ' Men are deserting every day.' : ' Miss another and men start deserting.'}
        </p>
      )}
      <h3>This week</h3>
      <dl className="small">
        <dt>Payroll</dt>
        <dd className={payroll > cash ? 'error' : ''}>
          {money(payroll)} in {Math.floor(untilPay / 24)}d {untilPay % 24}h
        </dd>
        <dt>Halcones</dt>
        <dd>{money(halcones)}</dd>
        <dt>Income / day</dt>
        <dd>{money(perDay)} (forecast)</dd>
        {tribute > 0 && (
          <>
            <dt>Tribute</dt>
            <dd>
              −{money(tribute)} / day ({Math.round(e.factionTributeRate * 100)}%)
            </dd>
          </>
        )}
        <dt>Net / week</dt>
        <dd className={weekNet < 0 ? 'error' : ''}>{money(weekNet)}</dd>
      </dl>
      <h3>Income by stream (forecast)</h3>
      <ul className="small mono plain">
        {[...byStream]
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => (
            <li key={k}>
              {INCOME_LABEL[k]}: {money(v)}
            </li>
          ))}
        {!byStream.size && <li className="muted">Nothing: you hold no plazas or routes.</li>}
      </ul>
      <h3>Last 14 days</h3>
      <LedgerChart days={me.ledger} />
      <p className="small muted">
        Last 7 days: in {money(week.income)}, out {money(week.costs)}.
      </p>
      {last && Object.keys(last.costs).length > 0 && (
        <p className="small muted">
          Today's costs:{' '}
          {Object.entries(last.costs)
            .map(([k, v]) => `${COST_LABEL[k as CostStream]} ${money(v ?? 0)}`)
            .join(' · ')}
        </p>
      )}
      <h3>Stash houses</h3>
      <ul className="small mono plain">
        {stashes.map((p) => (
          <li key={p.id}>
            {w.node(p.id).name}: {money(p.stash)}
          </li>
        ))}
      </ul>
      {stashes.length > 1 && (
        <div className="small movecash">
          <p className="muted">Spread cash so one raid can't take it all.</p>
          <div className="row">
            <select value={from} onChange={(ev) => setFrom(ev.target.value)}>
              <option value="">From…</option>
              {stashes.map((p) => (
                <option key={p.id} value={p.id}>
                  {w.node(p.id).name}
                </option>
              ))}
            </select>
            <select value={to} onChange={(ev) => setTo(ev.target.value)}>
              <option value="">To…</option>
              {stashes.map((p) => (
                <option key={p.id} value={p.id}>
                  {w.node(p.id).name}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            $<input type="number" step={10000} min={0} value={amount} onChange={(ev) => setAmount(Number(ev.target.value))} style={{ width: 90 }} />
            <button className="small" disabled={!from || !to || from === to} onClick={() => enqueue({ type: 'move_cash', issuer: me.id, from, to, amount })}>
              Move
            </button>
          </div>
        </div>
      )}
      {head && head !== me.id && (
        <>
          <h3>Faction</h3>
          <button
            disabled={!aidReady || queue.some((q) => q.type === 'request_aid')}
            onClick={() => enqueue({ type: 'request_aid', issuer: me.id })}
            title={`Up to ${money(e.aid.maxCash)}, once every ${e.aid.cooldownDays} days`}
          >
            {aidReady ? 'Ask the faction for money' : `Aid again in ${Math.ceil((e.aid.cooldownDays * 24 - (game.hour - me.lastAidAt!)) / 24)} days`}
          </button>
        </>
      )}
      <p className="muted small">Day {dayOf(game.hour)}. Income settles daily at midnight; payroll and halcones every Sunday.</p>
    </div>
  );
}
