import type { MouseEvent } from 'react';
import { crewNetwork, estimatedWatchersOf } from '../../sim/network';
import { lastSeen } from '../../sim/knowledge';
import type { CrewState, PathStep, RoutePreference } from '../../sim/state';
import { world } from '../../sim/world';
import { ownerColor, useGame } from '../store';
import { usePanZoom } from '../usePanZoom';
import { PREFERENCES, usePlanOptions } from '../usePlan';
import { charLabel, locationXY, playerNetwork } from '../util';

const ROAD_STYLE = {
  highway: { width: 4, dash: undefined },
  paved: { width: 2.5, dash: undefined },
  brecha: { width: 1.6, dash: '6 5' },
} as const;

const NODE_RADIUS = { city: 14, port: 10, town: 9, sierra_hub: 9, rancheria: 6, border_exit: 7 } as const;

export const ROUTE_COLORS: Record<RoutePreference, string> = { fastest: '#e0b64a', balanced: '#6fc3a0', safest: '#8fa8ff' };

function pathPoints(content: ReturnType<typeof useGame.getState>['content'], start: { x: number; y: number }, path: PathStep[]): string {
  const w = world(content);
  const pts = [start, ...path.map((s) => w.node(s.to))];
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

export function StateMap() {
  const { content, game, selected, select, plan, set, overlay, revealAll } = useGame();
  const options = usePlanOptions();
  const pz = usePanZoom({ x: 0, y: 0, w: 1000, h: 1000 });
  if (!game) return null;
  const w = world(content);
  const net = playerNetwork(game);
  const planning = plan ? game.crews[plan.crew] : undefined;

  const clickNode = (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (plan) {
      if (e.shiftKey && plan.destination) set({ plan: { ...plan, waypoints: [...plan.waypoints, plan.destination], destination: id } });
      else set({ plan: { ...plan, destination: id } });
      return;
    }
    select({ kind: 'node', id });
  };

  // Crews to draw: our network's, or everyone's with the fog lifted.
  const visible = Object.values(game.crews).filter((c) => c.order.type !== 'escort' && (revealAll || crewNetwork(game, c) === net));
  const byNode = new Map<string, CrewState[]>();
  for (const c of visible) {
    if (c.location.kind !== 'node') continue;
    byNode.set(c.location.node, [...(byNode.get(c.location.node) ?? []), c]);
  }
  const sightings = revealAll ? [] : lastSeen(game, content, net);
  const fade = content.tuning.detection.lastSeenFadeHours;
  const droneRoads = new Set(game.drones.filter((d) => d.network === net && game.hour < d.until).map((d) => d.road));
  const selectedCrew = selected?.kind === 'crew' ? game.crews[selected.id] : undefined;
  const scale = 1 / Math.sqrt(pz.zoom);

  return (
    <div className="mapwrap">
      <svg viewBox={pz.viewBox} className="svgmap" role="img" aria-label="Map of Sinaloa" {...pz.handlers} onClick={() => !plan && select(null)}>
        {overlay === 'war' &&
          content.nodes.map((n) => (
            <circle key={`war-${n.id}`} cx={n.x} cy={n.y} r={40} className={`ov-war ${game.regions[n.region]?.warState}`} />
          ))}
        {overlay === 'calentura' &&
          content.nodes.map((n) => {
            const cal = game.regions[n.region]?.calentura ?? 0;
            return <circle key={`cal-${n.id}`} cx={n.x} cy={n.y} r={48} fill="#e0503a" opacity={(cal / 100) * 0.35} />;
          })}
        {content.roads.map((r) => {
          const a = w.node(r.from);
          const b = w.node(r.to);
          const st = ROAD_STYLE[r.type];
          const isSel = selected?.kind === 'road' && selected.id === r.id;
          return (
            <g key={r.id} className="roadg" onClick={(e) => (e.stopPropagation(), !plan && select({ kind: 'road', id: r.id }))}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="roadhit" />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`road ${r.type}${droneRoads.has(r.id) ? ' drone' : ''}${isSel ? ' sel' : ''}`}
                strokeWidth={st.width}
                strokeDasharray={st.dash}
              />
            </g>
          );
        })}
        {options &&
          planning &&
          PREFERENCES.map((p, i) => {
            const r = options[p];
            if (!r) return null;
            const start = locationXY(content, planning.location);
            return (
              <polyline
                key={p}
                points={pathPoints(content, start, r.path)}
                className="route"
                stroke={ROUTE_COLORS[p]}
                strokeWidth={5 - i}
                transform={`translate(${(i - 1) * 3} ${(i - 1) * 3})`}
              />
            );
          })}
        {selectedCrew && 'path' in selectedCrew.order && selectedCrew.order.path.length > 0 && (
          <polyline points={pathPoints(content, locationXY(content, selectedCrew.location), selectedCrew.order.path)} className="route current" />
        )}
        {overlay !== 'none' &&
          overlay !== 'calentura' &&
          content.nodes.map((n) => {
            const plaza = game.nodes[n.id]!;
            if (overlay === 'income') return <circle key={`inc-${n.id}`} cx={n.x} cy={n.y} r={Math.sqrt(plaza.businesses) * 0.8} className="ov-income" />;
            const watchers = estimatedWatchersOf(game, content, n.id, net);
            return watchers.map((wt) => (
              <circle
                key={`hal-${n.id}-${wt.network}`}
                cx={n.x}
                cy={n.y}
                r={10 + wt.coverage * 0.3}
                className={wt.network === net ? 'ov-halcon own' : 'ov-halcon rival'}
              />
            ));
          })}
        {content.nodes.map((n) => {
          const plaza = game.nodes[n.id]!;
          const isSel = selected?.kind === 'node' && selected.id === n.id;
          const isDest = plan && (plan.destination === n.id || plan.waypoints.includes(n.id));
          const r = NODE_RADIUS[n.type];
          return (
            <g key={n.id} className="node" onClick={(e) => clickNode(e, n.id)}>
              {n.type === 'border_exit' ? (
                <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} className={`exit${isDest ? ' sel' : ''}`} />
              ) : (
                <circle cx={n.x} cy={n.y} r={r} fill={ownerColor(content, game, plaza.owner)} className={isSel || isDest ? 'sel' : ''} />
              )}
              <text x={n.x + r + 4} y={n.y + 4} fontSize={12 * scale}>
                {n.name}
              </text>
            </g>
          );
        })}
        {sightings.map((s) => {
          const p = locationXY(content, s.where);
          const opacity = Math.max(0.2, 1 - s.ageHours / (fade + 1));
          return (
            <g key={`seen-${s.crew}`} className="sighting" opacity={opacity} transform={`translate(${p.x + 10} ${p.y - 16}) scale(${scale})`}>
              <title>{`${charLabel(game, s.owner)}'s people · ${s.confidence} · ${s.ageHours}h ago`}</title>
              <rect x={-14} y={-9} width={28} height={18} rx={4} stroke={ownerColor(content, game, s.owner)} className={s.confidence} />
              <text textAnchor="middle" y={4}>
                {s.confidence === 'estimated' ? '~' : ''}
                {s.men}
              </text>
            </g>
          );
        })}
        {game.offensives
          .filter((o) => (o.status === 'gathering' || o.status === 'assault') && o.faction === game.characters[game.playerId]?.faction)
          .map((o) => {
            const n = w.node(o.target);
            return (
              <g key={o.id} className="offtarget" transform={`translate(${n.x} ${n.y})`} pointerEvents="none">
                <circle r={22} />
                <line x1={-28} x2={-14} y1={0} y2={0} />
                <line x1={14} x2={28} y1={0} y2={0} />
                <line y1={-28} y2={-14} x1={0} x2={0} />
                <line y1={14} y2={28} x1={0} x2={0} />
              </g>
            );
          })}
        {Object.values(game.battles)
          .filter((b) => b.endedAt === null && !b.colonia)
          .map((b) => {
            const p = locationXY(content, b.where);
            const isSel = selected?.kind === 'battle' && selected.id === b.id;
            return (
              <g
                key={b.id}
                className={`battle${isSel ? ' sel' : ''}`}
                transform={`translate(${p.x} ${p.y - 20}) scale(${scale})`}
                onClick={(e) => (e.stopPropagation(), select({ kind: 'battle', id: b.id }))}
              >
                <title>{b.type.replace('_', ' ')}</title>
                <circle r={11} />
                <text textAnchor="middle" y={5}>
                  ⚔
                </text>
              </g>
            );
          })}
        {visible.map((c) => {
          let p = locationXY(content, c.location);
          if (c.location.kind === 'node') {
            const stack = byNode.get(c.location.node)!;
            const i = stack.indexOf(c);
            p = { x: p.x - 14 + (i % 3) * 16 * scale, y: p.y + 16 + Math.floor(i / 3) * 14 * scale };
          }
          const isSel = selected?.kind === 'crew' && selected.id === c.id;
          const men = c.men + Object.values(game.crews).reduce((n, e) => n + (e.order.type === 'escort' && e.order.crew === c.id ? e.men : 0), 0);
          return (
            <g
              key={c.id}
              className={`crew${isSel ? ' sel' : ''}${c.order.type === 'lie_low' ? ' hidden' : ''}`}
              transform={`translate(${p.x} ${p.y}) scale(${scale})`}
              onClick={(e) => (e.stopPropagation(), select({ kind: 'crew', id: c.id }))}
            >
              <title>{`${charLabel(game, c.leader)} · ${c.order.type}`}</title>
              <rect x={-12} y={-8} width={24} height={16} rx={3} fill={ownerColor(content, game, c.owner)} />
              <text textAnchor="middle" y={4}>
                {men}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="maphint muted small">
        {plan
          ? 'Click a destination. Shift-click to add waypoints. Esc to cancel.'
          : 'Scroll to zoom, drag to pan. Click crews, plazas, or roads.'}
        <button className="small" onClick={pz.reset}>
          Reset view
        </button>
      </div>
    </div>
  );
}
