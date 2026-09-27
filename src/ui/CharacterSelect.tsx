import { useState } from 'react';
import { useGame } from './store';

const TIER_LABEL = { faction_head: 'Faction head · Hard', city_boss: 'City boss · Medium', town_jefe: 'Town jefe · Hard' };

export function CharacterSelect() {
  const content = useGame((s) => s.content);
  const start = useGame((s) => s.start);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));
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
      <p className="muted">Choose who you are when the war begins.</p>
      <label className="seed">
        Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
      </label>
      <div className="cards">
        {playable.map((c) => {
          const f = factionOf(c.faction);
          const men = c.crews.reduce((n, crew) => n + crew.men, 0);
          return (
            <button key={c.id} className="card" onClick={() => start(c.id, seed)} style={{ borderColor: f?.color }}>
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
