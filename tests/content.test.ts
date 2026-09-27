import { describe, expect, it } from 'vitest';
import { bundledContent, bundledRawContent } from '../src/data/bundled';
import { ContentError, loadContent } from '../src/data/content';

describe('content', () => {
  it('bundled content validates', () => {
    const c = bundledContent();
    expect(c.nodes.length).toBeGreaterThan(0);
    expect(c.factions.filter((f) => f.kind === 'major')).toHaveLength(2);
    expect(c.traits).toHaveLength(12);
    expect(c.nodes.length).toBeGreaterThanOrEqual(45);
    expect(c.culiacan.colonias).toHaveLength(16);
    const lieutenants = c.characters.filter((ch) => !['head', 'crew_leader'].includes(ch.rank));
    expect(lieutenants.length).toBeGreaterThanOrEqual(24);
    expect(c.events.length).toBeGreaterThanOrEqual(40);
  });

  it('rejects event keys outside the vocabulary', () => {
    const raw = structuredClone(bundledRawContent());
    const ev = raw.events['events/lab_raid_warning.json'] as { options: { effects: Record<string, unknown> }[] };
    ev.options[0]!.effects.teleport = true;
    expect(() => loadContent(raw)).toThrow(/lab_raid_warning\.json: options\.0\.effects/);
  });

  it('rejects events that can never fire', () => {
    const raw = structuredClone(bundledRawContent());
    delete (raw.events['events/fiesta_patronal.json'] as { mean_days?: number }).mean_days;
    expect(() => loadContent(raw)).toThrow(/fiesta_patronal: has no mean_days/);
  });

  it('every playable start owns a plaza or leads crews', () => {
    const c = bundledContent();
    for (const ch of c.characters.filter((x) => x.startTier !== null)) {
      const owns = c.nodes.some((n) => n.owner === ch.id);
      expect(owns || ch.crews.length > 0, ch.id).toBe(true);
    }
  });

  it('reports schema errors with file and path', () => {
    const raw = structuredClone(bundledRawContent());
    (raw.map as { nodes: { type: string }[] }).nodes[0]!.type = 'castle';
    expect(() => loadContent(raw)).toThrow(/map\.json: nodes\.0\.type/);
  });

  it('reports broken cross-references', () => {
    const raw = structuredClone(bundledRawContent());
    (raw.roads as { roads: { to: string }[] }).roads[0]!.to = 'atlantis';
    try {
      loadContent(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ContentError);
      expect((e as ContentError).problems.join('\n')).toContain('unknown to "atlantis"');
    }
  });

  it('rejects crews without enough seats', () => {
    const raw = structuredClone(bundledRawContent());
    const chars = (raw.characters as { characters: { crews: { men: number; vehicles: object }[] }[] }).characters;
    chars[0]!.crews[0]!.vehicles = { pickup: 1 };
    expect(() => loadContent(raw)).toThrow(/only 4 seats/);
  });

  it('rejects events that schedule unknown events', () => {
    const raw = structuredClone(bundledRawContent());
    const ev = raw.events['events/lab_raid_warning.json'] as { options: { effects: Record<string, unknown> }[] };
    ev.options[2]!.effects.schedule_event = 'no_such_event';
    expect(() => loadContent(raw)).toThrow(/unknown event "no_such_event"/);
  });
});
