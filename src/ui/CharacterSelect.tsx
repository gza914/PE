import { useState } from 'react';
import { autosaveSummary, useGame } from './store';

const TIER_LABEL = { faction_head: 'Faction head · Hard', city_boss: 'City boss · Medium', town_jefe: 'Town jefe · Hard' };

export function CharacterSelect() {
  const content = useGame((s) => s.content);
  const start = useGame((s) => s.start);
  const resume = useGame((s) => s.resume);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
  const [neutral, setNeutral] = useState(false);
  const [saved] = useState(() => autosaveSummary());
  const order = { faction_head: 0, city_boss: 1, town_jefe: 2 };
  const playable = content.characters
    .filter((c) => c.startTier !== null)
    .sort((a, b) => a.faction.localeCompare(b.faction) || order[a.startTier!] - order[b.startTier!]);
  const traitName = (id: string) => content.traits.find((t) => t.id === id)?.name ?? id;
  const factionOf = (id: string) => content.factions.find((f) => f.id === id);
  const nodeName = (id: string | null) => content.nodes.find((n) => n.id === id)?.name ?? '—';

  return (
    <div className="select">
      <h1>Cartel Conquest</h1>
      {saved && (
        <p>
          <button onClick={() => resume()}>Continue: {saved}</button>
        </p>
      )}
      <p className="muted">Choose who you are when the war begins.</p>
      <div className="row">
        <label className="seed">
          Seed{' '}
          <input
            id="seed"
            type="number"
            value={Number.isFinite(seed) ? seed : 0}
            onChange={(e) => setSeed(Number.isFinite(e.target.valueAsNumber) ? Math.floor(Math.abs(e.target.valueAsNumber)) % 2 ** 31 : 0)}
          />
        </label>
        <label title="Stay out of the war at first: both factions court you, and neighbors may come for your plazas. Faction heads cannot start neutral.">
          <input id="neutral" type="checkbox" checked={neutral} onChange={(e) => setNeutral(e.target.checked)} /> Start neutral
        </label>
      </div>
      <div className="cards">
        {playable.map((c) => {
          const f = factionOf(c.faction);
          const men = c.crews.reduce((n, crew) => n + crew.men, 0);
          return (
            <button key={c.id} className="card" onClick={() => start(c.id, seed, neutral && c.startTier !== 'faction_head')} style={{ borderColor: f?.color }}>
              <strong>{c.alias ?? c.name}</strong>
              {c.alias && <span className="muted small">{c.name}</span>}
              <span className="muted">{TIER_LABEL[c.startTier!]}</span>
              <span>
                {f?.name} · {nodeName(c.homePlaza)}
              </span>
              <span className="mono">
                V{c.skills.violencia} A{c.skills.astucia} N{c.skills.negocio} P{c.skills.palabra}
              </span>
              <span className="muted">{c.traits.map(traitName).join(', ')}</span>
              <span className="mono">
                {men} men · ${c.cash.toLocaleString()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
