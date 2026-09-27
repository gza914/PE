import { visibleInColonia } from '../../sim/knowledge';
import { crewNetwork } from '../../sim/network';
import { useGame } from '../store';
import { playerNetwork } from '../util';

export function CuliacanMap() {
  const { content, game, selected, select, revealAll } = useGame();
  if (!game) return null;
  const { colonias, streets, positiveFaction, parentNode } = content.culiacan;
  const pos = new Map(colonias.map((c) => [c.id, c]));
  const flip = content.tuning.map.coloniaFlipThreshold;
  const plus = content.factions.find((f) => f.id === positiveFaction)!;
  const minus = content.factions.find((f) => f.kind === 'major' && f.id !== positiveFaction)!;
  const net = playerNetwork(game);
  const inCity = Object.values(game.crews).filter((c) => c.location.kind === 'node' && c.location.node === parentNode);
  const uncommitted = inCity.filter((c) => c.colonia === null && crewNetwork(game, c) === net && c.order.type !== 'escort');

  return (
    <div className="mapwrap">
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
          const ours = inCity.filter((x) => x.colonia === c.id && crewNetwork(game, x) === net).reduce((n, x) => n + x.men, 0);
          const theirs = (revealAll ? inCity.filter((x) => x.colonia === c.id && crewNetwork(game, x) !== net) : visibleInColonia(game, content, net, c.id)).reduce(
            (n, x) => n + x.men,
            0,
          );
          const fighting = Object.values(game.battles).some((b) => b.colonia === c.id && b.endedAt === null);
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
              {ours > 0 && (
                <g transform={`translate(${c.x - 30} ${c.y - 34})`} className="crew">
                  <rect x={-12} y={-8} width={24} height={16} rx={3} fill={content.factions.find((f) => f.id === net)?.color ?? '#b9a36b'} />
                  <text textAnchor="middle" y={4}>
                    {ours}
                  </text>
                </g>
              )}
              {theirs > 0 && (
                <g transform={`translate(${c.x + 30} ${c.y - 34})`} className="sighting">
                  <rect x={-12} y={-8} width={24} height={16} rx={3} stroke="#ddd" className="confirmed" />
                  <text textAnchor="middle" y={4}>
                    {theirs}
                  </text>
                </g>
              )}
              {fighting && (
                <text x={c.x} y={c.y - 42} textAnchor="middle" className="battleicon">
                  ⚔
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="maphint muted small">
        Filled badges: your side's men. Outlined: rivals you can see. Click a colonia to deploy crews.
        {uncommitted.length > 0 && ` ${uncommitted.length} of your side's crews in the city are not committed.`}
      </div>
    </div>
  );
}
