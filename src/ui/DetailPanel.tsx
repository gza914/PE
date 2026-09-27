import { useGame } from './store';

export function DetailPanel() {
  const { content, game, selected } = useGame();
  if (!game) return null;
  if (!selected) return <p className="muted">Select a plaza or colonia.</p>;

  if (selected.kind === 'node') {
    const def = content.nodes.find((n) => n.id === selected.id)!;
    const p = game.nodes[selected.id]!;
    const owner = p.owner ? game.characters[p.owner] : null;
    const crews = Object.values(game.crews).filter((c) => c.location.kind === 'node' && c.location.node === selected.id);
    return (
      <div>
        <h2>{def.name}</h2>
        <p className="muted">
          {def.type.replace('_', ' ')} · {content.regions.find((r) => r.id === def.region)?.name}
        </p>
        <dl>
          <dt>Owner</dt>
          <dd>{owner?.name ?? (def.hasSubmap ? 'Contested (see Culiacán view)' : 'None')}</dd>
          <dt>Fortification</dt>
          <dd>{p.fortification} / 3</dd>
          <dt>Support</dt>
          <dd>{p.support}</dd>
          <dt>Halcones</dt>
          <dd>{p.halconCoverage}</dd>
          <dt>Businesses</dt>
          <dd>{p.businesses}</dd>
          <dt>Labs</dt>
          <dd>{p.labs}</dd>
          <dt>Military</dt>
          <dd>{p.militaryPresence} / 3</dd>
          <dt>Extortion</dt>
          <dd>{p.extortionRate}</dd>
        </dl>
        {crews.length > 0 && (
          <>
            <h3>Crews here</h3>
            <ul className="mono small">
              {crews.map((c) => (
                <li key={c.id}>
                  {game.characters[c.leader]?.name}: {c.men} men, S{c.skill} G{c.gear}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (selected.kind === 'colonia') {
    const def = content.culiacan.colonias.find((c) => c.id === selected.id)!;
    return (
      <div>
        <h2>{def.name}</h2>
        <dl>
          <dt>Control</dt>
          <dd>{game.colonias[selected.id]!.control}</dd>
          <dt>Businesses</dt>
          <dd>{def.businesses}</dd>
        </dl>
      </div>
    );
  }

  return null;
}
