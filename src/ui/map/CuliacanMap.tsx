import { useGame } from '../store';

export function CuliacanMap() {
  const { content, game, selected, select } = useGame();
  if (!game) return null;
  const { colonias, streets, positiveFaction } = content.culiacan;
  const pos = new Map(colonias.map((c) => [c.id, c]));
  const flip = content.tuning.map.coloniaFlipThreshold;
  const plus = content.factions.find((f) => f.id === positiveFaction)!;
  const minus = content.factions.find((f) => f.kind === 'major' && f.id !== positiveFaction)!;

  return (
    <svg viewBox="0 0 1000 700" className="svgmap" role="img" aria-label="Culiacán colonias">
      {streets.map((s) => {
        const a = pos.get(s.from)!;
        const b = pos.get(s.to)!;
        return <line key={`${s.from}-${s.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="road paved" strokeWidth={3} />;
      })}
      {colonias.map((c) => {
        const control = game.colonias[c.id]!.control;
        const fill = control >= flip ? plus.color : control <= -flip ? minus.color : '#8a7a4a';
        const isSel = selected?.kind === 'colonia' && selected.id === c.id;
        return (
          <g key={c.id} className="node" onClick={() => select({ kind: 'colonia', id: c.id })}>
            <circle cx={c.x} cy={c.y} r={34} fill={fill} opacity={0.35 + (Math.abs(control) / 100) * 0.65} className={isSel ? 'sel' : ''} />
            <text x={c.x} y={c.y + 4} textAnchor="middle">
              {c.name}
            </text>
            <text x={c.x} y={c.y + 52} textAnchor="middle" className="mono small">
              {control > 0 ? '+' : ''}
              {Math.round(control)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
