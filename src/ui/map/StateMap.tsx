import { ownerColor, useGame } from '../store';

const ROAD_STYLE = {
  highway: { width: 4, dash: undefined },
  paved: { width: 2.5, dash: undefined },
  brecha: { width: 1.5, dash: '6 5' },
} as const;

const NODE_RADIUS = { city: 14, port: 10, town: 9, sierra_hub: 9, rancheria: 6, border_exit: 7 } as const;

export function StateMap() {
  const { content, game, selected, select } = useGame();
  if (!game) return null;
  const pos = new Map(content.nodes.map((n) => [n.id, n]));

  return (
    <svg viewBox="0 0 1000 1000" className="svgmap" role="img" aria-label="Map of Sinaloa">
      {content.roads.map((r) => {
        const a = pos.get(r.from)!;
        const b = pos.get(r.to)!;
        const st = ROAD_STYLE[r.type];
        return <line key={r.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`road ${r.type}`} strokeWidth={st.width} strokeDasharray={st.dash} />;
      })}
      {content.nodes.map((n) => {
        const plaza = game.nodes[n.id]!;
        const isSel = selected?.kind === 'node' && selected.id === n.id;
        const r = NODE_RADIUS[n.type];
        return (
          <g key={n.id} className="node" onClick={() => select({ kind: 'node', id: n.id })}>
            {n.type === 'border_exit' ? (
              <rect x={n.x - r} y={n.y - r} width={r * 2} height={r * 2} className="exit" />
            ) : (
              <circle cx={n.x} cy={n.y} r={r} fill={ownerColor(content, game, plaza.owner)} className={isSel ? 'sel' : ''} />
            )}
            <text x={n.x + r + 4} y={n.y + 4}>
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
