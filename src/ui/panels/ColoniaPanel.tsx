import { visibleInColonia } from '../../sim/knowledge';
import { crewNetwork } from '../../sim/network';
import { useGame } from '../store';
import { charLabel, crewLabel, playerNetwork } from '../util';

export function ColoniaPanel({ id }: { id: string }) {
  const { content, game, enqueue, select, revealAll } = useGame();
  if (!game) return null;
  const def = content.culiacan.colonias.find((c) => c.id === id)!;
  const control = game.colonias[id]!.control;
  const flip = content.tuning.map.coloniaFlipThreshold;
  const pos = content.factions.find((f) => f.id === content.culiacan.positiveFaction)!;
  const neg = content.factions.find((f) => f.kind === 'major' && f.id !== pos.id)!;
  const holder = control >= flip ? pos.name : control <= -flip ? neg.name : 'Contested';
  const net = playerNetwork(game);
  const city = content.culiacan.parentNode;
  const here = Object.values(game.crews).filter((c) => c.colonia === id && c.location.kind === 'node' && c.location.node === city);
  const ours = here.filter((c) => crewNetwork(game, c) === net);
  const theirs = revealAll ? here.filter((c) => crewNetwork(game, c) !== net) : visibleInColonia(game, content, net, id);
  const deployable = Object.values(game.crews).filter(
    (c) => c.owner === game.playerId && c.location.kind === 'node' && c.location.node === city && c.colonia !== id && c.battle === null && c.order.type !== 'escort',
  );
  const battle = Object.values(game.battles).find((b) => b.colonia === id && b.endedAt === null);

  return (
    <div>
      <h2>{def.name}</h2>
      <p className="muted">Culiacán colonia · {holder}</p>
      <div className="controlbar" title={`Control ${Math.round(control)}: ${pos.name} +100, ${neg.name} −100`}>
        <div className="mid" />
        <div className="marker" style={{ left: `${(control + 100) / 2}%` }} />
      </div>
      <p className="mono small">
        Control {control > 0 ? '+' : ''}
        {Math.round(control)} (flips at ±{flip}) · {def.businesses} businesses
      </p>
      {battle && (
        <p className="inbattle">
          Street fighting here.{' '}
          <button className="linkish" onClick={() => select({ kind: 'battle', id: battle.id })}>
            Open the battle
          </button>
        </p>
      )}
      <h3>Your side here</h3>
      {ours.length ? (
        <ul className="links small">
          {ours.map((c) => (
            <li key={c.id}>
              <button className="linkish" onClick={() => select({ kind: 'crew', id: c.id })}>
                {crewLabel(game, c)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">None.</p>
      )}
      <h3>Rivals seen here</h3>
      {theirs.length ? (
        <ul className="small">
          {theirs.map((c) => (
            <li key={c.id}>
              {charLabel(game, c.owner)}'s people · {c.men} men
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{ours.length || holder !== 'Contested' ? 'None.' : 'Unknown: you have no one here.'}</p>
      )}
      {deployable.length > 0 && (
        <>
          <h3>Deploy here</h3>
          <ul className="links small">
            {deployable.map((c) => (
              <li key={c.id} className="row">
                <span className="grow">{crewLabel(game, c)}</span>
                <button className="small" onClick={() => enqueue({ type: 'deploy_crew', issuer: game.playerId, crew: c.id, colonia: id })}>
                  Deploy
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">
        Crews committed to a colonia fight rival crews there every hour. Holding it alone slowly pushes control your way.
      </p>
    </div>
  );
}
