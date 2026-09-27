import { formatDateTime } from '../sim/clock';
import { useGame } from './store';

export function Feed() {
  const { content, game, select } = useGame();
  if (!game) return null;
  const entries = [...game.feed].reverse().slice(0, 200);
  return (
    <div className="feed">
      <h2>Reports</h2>
      {entries.length === 0 && <p className="muted">No reports yet.</p>}
      {entries.map((e) => (
        <button key={e.id} className={`entry ${e.tier}`} onClick={() => e.node && select({ kind: 'node', id: e.node })}>
          <span className="muted small">{formatDateTime(e.hour, content.tuning)}</span>
          <span className="mono">{e.text}</span>
        </button>
      ))}
    </div>
  );
}
