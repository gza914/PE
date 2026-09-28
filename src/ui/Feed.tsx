import { useState } from 'react';
import { formatDateTime } from '../sim/clock';
import { ledger } from '../sim/knowledge';
import { EconomyPanel } from './panels/EconomyPanel';
import { useGame } from './store';
import { charLabel, locationName, playerNetwork, vehicleSummary } from './util';

export function Feed() {
  const [tab, setTab] = useState<'feed' | 'intel' | 'money'>('feed');
  return (
    <div className="feed">
      <div className="tabs">
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
          Reports
        </button>
        <button className={tab === 'intel' ? 'on' : ''} onClick={() => setTab('intel')}>
          Intel
        </button>
        <button className={tab === 'money' ? 'on' : ''} onClick={() => setTab('money')}>
          Economy
        </button>
      </div>
      {tab === 'feed' ? <ReportFeed /> : tab === 'intel' ? <IntelLedger /> : <EconomyPanel />}
    </div>
  );
}

function ReportFeed() {
  const { content, game, select } = useGame();
  if (!game) return null;
  const net = playerNetwork(game);
  const entries = game.feed.filter((e) => e.audience === null || e.audience === net).reverse().slice(0, 200);
  return (
    <>
      {entries.length === 0 && <p className="muted">No reports yet.</p>}
      {entries.map((e) => (
        <button
          key={e.id}
          className={`entry ${e.tier}`}
          onClick={() => (e.battle && game.battles[e.battle] ? select({ kind: 'battle', id: e.battle }) : e.node && select({ kind: 'node', id: e.node }))}
        >
          <span className="muted small">{formatDateTime(e.hour, content.tuning)}</span>
          <span className="mono">{e.text}</span>
        </button>
      ))}
    </>
  );
}

function IntelLedger() {
  const { content, game, select } = useGame();
  if (!game) return null;
  const rows = ledger(game, playerNetwork(game)).slice(0, 300);
  if (!rows.length) return <p className="muted">Your network has no reports on rival crews yet.</p>;
  return (
    <>
      {rows.map((r) => (
        <button
          key={r.id}
          className={`entry ${r.ageHours > content.tuning.detection.lastSeenFadeHours ? 'stale' : ''}`}
          onClick={() => select(r.where.kind === 'node' ? { kind: 'node', id: r.where.node } : { kind: 'road', id: r.where.road })}
        >
          <span className="muted small">
            {r.ageHours}h ago · {r.source} · {r.confidence}
          </span>
          <span className="mono">
            {r.confidence === 'estimated' ? '~' : ''}
            {r.men} men ({vehicleSummary(r.vehicles)}), {charLabel(game, r.owner)}'s, {locationName(content, r.where)}
          </span>
        </button>
      ))}
    </>
  );
}
