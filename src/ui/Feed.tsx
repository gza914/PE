import { useState } from 'react';
import { formatDateTime } from '../sim/clock';
import { EconomyPanel } from './panels/EconomyPanel';
import { FactionPanel } from './panels/FactionPanel';
import { ShadowPanel } from './panels/ShadowPanel';
import { DiplomacyPanel } from './panels/DiplomacyPanel';
import { IntelPanel } from './panels/IntelPanel';
import { useGame } from './store';
import { playerNetwork } from './util';

export function Feed() {
  const [tab, setTab] = useState<'feed' | 'intel' | 'money' | 'faction' | 'shadow' | 'diplomacy'>('feed');
  const diplomacyCount = useGame((s) =>
    s.game
      ? s.game.operations.filter((o) => o.status === 'planning' && o.invites.some((i) => i.to === s.game!.playerId && i.status === 'pending')).length +
        s.game.pactOffers.filter((o) => o.to === s.game!.playerId).length +
        s.game.operations.filter((o) => o.status === 'planning' && o.proposer === s.game!.playerId && o.invites.some((i) => i.status === 'countered')).length
      : 0,
  );
  const pendingCount = useGame((s) => (s.game ? s.game.requests.filter((r) => r.to === s.game!.playerId && r.status === 'pending').length : 0));
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
        <button className={tab === 'faction' ? 'on' : ''} onClick={() => setTab('faction')}>
          Faction{pendingCount > 0 && <span className="badge">{pendingCount}</span>}
        </button>
        <button className={tab === 'diplomacy' ? 'on' : ''} onClick={() => setTab('diplomacy')}>
          Diplomacy{diplomacyCount > 0 && <span className="badge">{diplomacyCount}</span>}
        </button>
        <button className={tab === 'shadow' ? 'on' : ''} onClick={() => setTab('shadow')}>
          Shadows
        </button>
      </div>
      {tab === 'feed' ? <ReportFeed /> : tab === 'intel' ? <IntelPanel /> : tab === 'money' ? <EconomyPanel /> : tab === 'faction' ? <FactionPanel /> : tab === 'diplomacy' ? <DiplomacyPanel /> : <ShadowPanel />}
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
