import { useState } from 'react';
import { formatDateTime, hourOfDay } from '../../sim/clock';
import { ROUTE_COLORS } from '../map/StateMap';
import { useGame } from '../store';
import { PREFERENCES, usePlanOptions } from '../usePlan';
import { fmtHours, pct } from '../util';

/** Pick a destination on the map, compare three routes, optionally sync arrival. */
export function RoutePlanner() {
  const { content, game, plan, set, enqueue, syncHour } = useGame();
  const options = usePlanOptions();
  const [sync, setSync] = useState(syncHour !== null);
  const [arrive, setArrive] = useState<number>(() => syncHour ?? (game ? game.hour + 12 : 12));
  if (!game || !plan) return null;
  const crew = game.crews[plan.crew]!;
  const dest = plan.destination ? content.nodes.find((n) => n.id === plan.destination) : undefined;

  const go = (pref: (typeof PREFERENCES)[number]) => {
    enqueue({
      type: 'order_crew',
      issuer: crew.owner,
      crew: crew.id,
      order: { type: 'move', destination: plan.destination!, preference: pref, waypoints: plan.waypoints, arriveAt: sync ? arrive : null },
    });
    set({ plan: null, syncHour: sync ? arrive : null });
  };

  const day = Math.floor(arrive / 24);
  return (
    <div className="planner">
      <h3>Plan route</h3>
      {!dest && <p className="muted">Click a destination on the map.</p>}
      {dest && (
        <p>
          To <strong>{dest.name}</strong>
          {plan.waypoints.length > 0 && (
            <span className="muted"> via {plan.waypoints.map((id) => content.nodes.find((n) => n.id === id)?.name).join(', ')}</span>
          )}
        </p>
      )}
      {options &&
        PREFERENCES.map((p) => {
          const r = options[p];
          return (
            <button key={p} className="routeopt" disabled={!r} onClick={() => go(p)} style={{ borderLeftColor: ROUTE_COLORS[p] }}>
              <strong>{p[0]!.toUpperCase() + p.slice(1)}</strong>
              {r ? (
                <span className="mono small">
                  {fmtHours(r.hours)} · {Math.round(r.km)} km · est. risk {pct(r.detectionRisk)}
                </span>
              ) : (
                <span className="muted small">No route for these vehicles</span>
              )}
            </button>
          );
        })}
      {options && (
        <p className="muted small">Risk is estimated from what your network knows. Rival halcón coverage is a guess.</p>
      )}
      <label className="row">
        <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Sync arrival
      </label>
      {sync && (
        <div className="row small">
          Arrive day
          <input type="number" min={Math.floor(game.hour / 24)} value={day} onChange={(e) => setArrive(Number(e.target.value) * 24 + hourOfDay(arrive))} />
          at
          <input type="number" min={0} max={23} value={hourOfDay(arrive)} onChange={(e) => setArrive(day * 24 + Math.min(23, Math.max(0, Number(e.target.value))))} />
          :00
        </div>
      )}
      {sync && <p className="muted small">{formatDateTime(arrive, content.tuning)}. Order other crews with the same time to hit together.</p>}
      <button onClick={() => set({ plan: null })}>Cancel</button>
    </div>
  );
}
