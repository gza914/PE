import { CrewPanel } from './panels/CrewPanel';
import { NodePanel } from './panels/NodePanel';
import { RoadPanel } from './panels/RoadPanel';
import { useGame } from './store';

export function DetailPanel() {
  const { content, game, selected, lastError } = useGame();
  if (!game) return null;
  const error = lastError && <p className="error small">Order refused: {lastError}</p>;
  if (!selected) {
    return (
      <div>
        {error}
        <p className="muted">Select a crew, plaza, or road.</p>
        <p className="muted small">Your crews are the filled markers. Outlined markers are rival crews your network has spotted; they fade as the report ages.</p>
      </div>
    );
  }
  if (selected.kind === 'crew') {
    const crew = game.crews[selected.id];
    return (
      <>
        {error}
        {crew ? <CrewPanel crew={crew} /> : <p className="muted">That crew no longer exists.</p>}
      </>
    );
  }
  if (selected.kind === 'node') return (<>{error}<NodePanel id={selected.id} /></>);
  if (selected.kind === 'road') return (<>{error}<RoadPanel id={selected.id} /></>);
  const def = content.culiacan.colonias.find((c) => c.id === selected.id)!;
  return (
    <div>
      <h2>{def.name}</h2>
      <dl>
        <dt>Control</dt>
        <dd>{Math.round(game.colonias[selected.id]!.control)}</dd>
        <dt>Businesses</dt>
        <dd>{def.businesses}</dd>
      </dl>
    </div>
  );
}
