import { lastSeen } from '../../sim/knowledge';
import { cashOf } from '../../sim/money';
import { world } from '../../sim/world';
import { useGame } from '../store';
import { charLabel, playerNetwork } from '../util';

export function RoadPanel({ id }: { id: string }) {
  const { content, game, enqueue, queue } = useGame();
  if (!game) return null;
  const w = world(content);
  const road = w.road(id);
  const t = content.tuning;
  const net = playerNetwork(game);
  const drone = game.drones.find((d) => d.road === id && d.network === net && game.hour < d.until);
  const queued = queue.some((q) => q.type === 'launch_drone' && q.road === id);
  const cash = cashOf(game, game.playerId);
  const seen = lastSeen(game, content, net).filter((s) => s.where.kind === 'road' && s.where.road === id);

  return (
    <div>
      <h2>
        {w.node(road.from).name} – {w.node(road.to).name}
      </h2>
      <p className="muted">
        {road.type} · {road.lengthKm} km · {road.terrain.replace('_', ' ')}
      </p>
      <dl>
        <dt>Speed</dt>
        <dd>{t.roads[road.type].speed}×</dd>
        <dt>Visibility</dt>
        <dd>{t.roads[road.type].visibility}×</dd>
        {road.passesNear.length > 0 && (
          <>
            <dt>Passes near</dt>
            <dd>{road.passesNear.map((n) => w.node(n).name).join(', ')}</dd>
          </>
        )}
      </dl>
      <h3>Drone</h3>
      {drone ? (
        <p>Drone overhead: every unit on this road is visible for {drone.until - game.hour} more hours.</p>
      ) : (
        <>
          <button disabled={queued || cash < t.detection.droneCost} onClick={() => enqueue({ type: 'launch_drone', issuer: game.playerId, road: id })}>
            {queued ? 'Drone queued' : `Launch drone ($${t.detection.droneCost.toLocaleString()})`}
          </button>
          <p className="muted small">
            Reveals every unit on this segment for {t.detection.droneRevealHours} hours. Alert crews may notice it.
          </p>
        </>
      )}
      {seen.length > 0 && (
        <>
          <h3>Reported on this road</h3>
          <ul className="mono small">
            {seen.map((s) => (
              <li key={s.id}>
                {s.confidence === 'estimated' ? '~' : ''}
                {s.men} men, {charLabel(game, s.owner)}'s · {s.source} · {s.ageHours}h ago
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
