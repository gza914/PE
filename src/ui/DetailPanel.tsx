import { BattlePanel } from './panels/BattlePanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { ColoniaPanel } from './panels/ColoniaPanel';
import { CrewPanel } from './panels/CrewPanel';
import { NodePanel } from './panels/NodePanel';
import { RoadPanel } from './panels/RoadPanel';
import { useGame } from './store';

export function DetailPanel() {
  const { game, selected, lastError } = useGame();
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
  if (selected.kind === 'character') return (<>{error}<CharacterPanel id={selected.id} /></>);
  if (selected.kind === 'node') return (<>{error}<NodePanel id={selected.id} /></>);
  if (selected.kind === 'road') return (<>{error}<RoadPanel id={selected.id} /></>);
  if (selected.kind === 'battle') {
    const b = game.battles[selected.id];
    return (
      <>
        {error}
        {b ? <BattlePanel battle={b} /> : <p className="muted">That battle is long over.</p>}
      </>
    );
  }
  return (
    <>
      {error}
      <ColoniaPanel id={selected.id} />
    </>
  );
}
