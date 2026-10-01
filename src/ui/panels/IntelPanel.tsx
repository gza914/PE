import { useState } from 'react';
import { fmtRange } from '../../sim/estimate';
import { ledger, plazaIntel } from '../../sim/knowledge';
import { networkOf } from '../../sim/network';
import type { ReportSource } from '../../sim/state';
import { useGame } from '../store';
import { charLabel, fmtHours, locationName, playerNetwork, vehicleSummary } from '../util';

const SOURCE: Record<ReportSource, string> = {
  halcon: 'halcones',
  patrol: 'patrols',
  drone: 'drones',
  presence: 'our crews',
  rumor: 'rumor',
  informant: 'informant',
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

/**
 * The Intel screen: every town your side does not hold, with its strength as a
 * range, the sources behind it and their age, and your eyes there.
 */
export function IntelPanel() {
  const [view, setView] = useState<'towns' | 'reports'>('towns');
  return (
    <div className="intel">
      <div className="actions">
        <button className={`small ${view === 'towns' ? 'on' : ''}`} onClick={() => setView('towns')}>
          Towns
        </button>
        <button className={`small ${view === 'reports' ? 'on' : ''}`} onClick={() => setView('reports')}>
          All reports
        </button>
      </div>
      {view === 'towns' ? <Towns /> : <Ledger />}
    </div>
  );
}

function Towns() {
  const { content, game, select, enqueue } = useGame();
  if (!game) return null;
  const net = playerNetwork(game);
  const me = game.playerId;
  const t = content.tuning.intel;
  const window = content.tuning.detection.reportRetentionHours;
  const rows = content.nodes
    .filter((n) => n.type !== 'border_exit' && n.id !== content.culiacan.parentNode)
    .filter((n) => {
      const o = game.nodes[n.id]!.owner;
      return o === null || networkOf(game, o) !== net;
    })
    .map((n) => ({ n, pi: plazaIntel(game, content, net, n.id, window), owner: game.nodes[n.id]!.owner }))
    .filter((x) => x.owner !== null || x.pi.crews.length > 0)
    .sort((a, b) => (a.pi.age ?? Infinity) - (b.pi.age ?? Infinity) || a.n.name.localeCompare(b.n.name));
  const mine = game.informants.filter((i) => i.owner === me);
  return (
    <>
      <p className="muted small">
        Strength is a range: more sources narrow it, age widens it. Only someone inside (a crew or an informant) sees the whole garrison. Informants {money(t.informant.cost)}, settle in{' '}
        {t.informant.settleDays} days; drones over a town {money(t.droneTown.cost)} for {t.droneTown.hours}h.
      </p>
      {rows.length === 0 && <p className="muted">No rival towns.</p>}
      {rows.map(({ n, pi, owner }) => {
        const inf = game.informants.find((i) => i.network === net && i.node === n.id);
        const drone = game.drones.some((d) => d.network === net && d.node === n.id && game.hour < d.until);
        const src = Object.entries(pi.sources)
          .map(([k, v]) => `${SOURCE[k as ReportSource]} ×${v}`)
          .join(', ');
        return (
          <div key={n.id} className="intelrow">
            <div className="row">
              <button className="linkish" onClick={() => select({ kind: 'node', id: n.id })}>
                {n.name}
              </button>
              <span className="muted small">{owner ? charLabel(game, owner) : 'no one'}</span>
            </div>
            <div className="mono small">
              {pi.crews.length ? (
                <>
                  {fmtRange(pi)} men{pi.complete ? '' : ' seen (maybe more)'} · newest {fmtHours(pi.age!)} ago
                </>
              ) : (
                <span className="muted">no recent reports</span>
              )}
            </div>
            {src && <div className="muted small">Sources: {src}</div>}
            <div className="actions">
              {inf ? (
                <>
                  <span className="small">
                    Informant {game.hour < inf.activeAt ? `settling in (${fmtHours(inf.activeAt - game.hour)})` : `reporting · quality ${Math.round(inf.quality * 100)}%`}
                    {inf.owner !== me && ` · ${charLabel(game, inf.owner)}'s`}
                  </span>
                  {inf.owner === me && (
                    <button className="small" onClick={() => enqueue({ type: 'pull_informant', issuer: me, informant: inf.id })}>
                      Pull him out
                    </button>
                  )}
                </>
              ) : (
                owner !== null && (
                  <button className="small" disabled={mine.length >= t.informant.maxPerNetwork} title={`${money(t.informant.cost)}: reports every ${t.informant.reportEveryHours}h once settled; may be caught`} onClick={() => enqueue({ type: 'plant_informant', issuer: me, node: n.id })}>
                    Plant an informant
                  </button>
                )
              )}
              <button className="small" disabled={drone} title={`${money(t.droneTown.cost)}: counts vehicles and men in the street for ${t.droneTown.hours}h; misses men indoors`} onClick={() => enqueue({ type: 'launch_drone', issuer: me, node: n.id })}>
                {drone ? 'Drone overhead' : 'Drone over town'}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Ledger() {
  const { content, game, select } = useGame();
  if (!game) return null;
  const rows = ledger(game, playerNetwork(game)).slice(0, 300);
  if (!rows.length) return <p className="muted">Your network has no reports on rival crews yet.</p>;
  return (
    <>
      {rows.map((r) => (
        <button
          key={r.id}
          className={`entry ${r.ageHours > content.tuning.detection.lastSeenFadeHours ? 'stale' : ''}`}
          onClick={() => select(r.where.kind === 'node' ? { kind: 'node', id: r.where.node } : { kind: 'road', id: r.where.road })}
        >
          <span className="muted small">
            {r.ageHours}h ago · {SOURCE[r.source]}
          </span>
          <span className="mono">
            {fmtRange(r)} men ({vehicleSummary(r.vehicles)}), {charLabel(game, r.owner)}'s, {locationName(content, r.where)}
          </span>
        </button>
      ))}
    </>
  );
}
