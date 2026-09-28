/**
 * Loads and validates all content. Schema errors and broken cross-references
 * throw a ContentError listing every problem found, so bad data never reaches
 * the simulation.
 */
import type { z } from 'zod';
import {
  CharactersFileSchema,
  ColoniasFileSchema,
  EventSchema,
  FactionsFileSchema,
  MapFileSchema,
  MessagesFileSchema,
  RoadsFileSchema,
  RoutesFileSchema,
  TraitsFileSchema,
  TuningSchema,
  type CharacterDef,
  type Colonia,
  type Faction,
  type GameEvent,
  type MapNode,
  type MessageTemplate,
  type Region,
  type Road,
  type TradeRoute,
  type Street,
  type Trait,
  type Tuning,
} from './schemas';

export interface Content {
  regions: Region[];
  nodes: MapNode[];
  roads: Road[];
  routes: TradeRoute[];
  culiacan: { parentNode: string; positiveFaction: string; colonias: Colonia[]; streets: Street[] };
  factions: Faction[];
  traits: Trait[];
  characters: CharacterDef[];
  messages: MessageTemplate[];
  events: GameEvent[];
  tuning: Tuning;
}

/** Raw, unvalidated JSON for each content file. */
export interface RawContent {
  map: unknown;
  roads: unknown;
  routes: unknown;
  colonias: unknown;
  factions: unknown;
  traits: unknown;
  characters: unknown;
  messages: unknown;
  /** Keyed by file name, for error messages. */
  events: Record<string, unknown>;
  tuning: unknown;
}

export class ContentError extends Error {
  constructor(readonly problems: string[]) {
    super(`Content failed validation:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ContentError';
  }
}

function parse<S extends z.ZodType>(schema: S, data: unknown, file: string, problems: string[]): z.infer<S> | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    problems.push(`${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  return undefined;
}

export function loadContent(raw: RawContent): Content {
  const problems: string[] = [];

  const map = parse(MapFileSchema, raw.map, 'map.json', problems);
  const roads = parse(RoadsFileSchema, raw.roads, 'roads.json', problems);
  const routes = parse(RoutesFileSchema, raw.routes, 'routes.json', problems);
  const colonias = parse(ColoniasFileSchema, raw.colonias, 'colonias.json', problems);
  const factions = parse(FactionsFileSchema, raw.factions, 'factions.json', problems);
  const traits = parse(TraitsFileSchema, raw.traits, 'traits.json', problems);
  const characters = parse(CharactersFileSchema, raw.characters, 'characters.json', problems);
  const messages = parse(MessagesFileSchema, raw.messages, 'messages.json', problems);
  const tuning = parse(TuningSchema, raw.tuning, 'tuning.json', problems);
  const events: GameEvent[] = [];
  for (const [file, data] of Object.entries(raw.events).sort(([a], [b]) => a.localeCompare(b))) {
    const ev = parse(EventSchema, data, file, problems);
    if (ev) events.push(ev);
  }

  if (!map || !roads || !routes || !colonias || !factions || !traits || !characters || !messages || !tuning || problems.length) {
    throw new ContentError(problems);
  }

  const content: Content = {
    regions: map.regions,
    nodes: map.nodes,
    roads: roads.roads,
    routes: routes.routes,
    culiacan: colonias,
    factions: factions.factions,
    traits: traits.traits,
    characters: characters.characters,
    messages: messages.messages,
    events,
    tuning,
  };

  problems.push(...crossReferenceProblems(content));
  if (problems.length) throw new ContentError(problems);
  return content;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const i of ids) (seen.has(i) ? dup : seen).add(i);
  return [...dup];
}

/** Checks every id reference between files. Exported for tests. */
export function crossReferenceProblems(c: Content): string[] {
  const p: string[] = [];
  const regionIds = new Set(c.regions.map((r) => r.id));
  const nodeIds = new Set(c.nodes.map((n) => n.id));
  const factionIds = new Set(c.factions.map((f) => f.id));
  const traitIds = new Set(c.traits.map((t) => t.id));
  const charIds = new Set(c.characters.map((ch) => ch.id));
  const coloniaIds = new Set(c.culiacan.colonias.map((col) => col.id));
  const eventIds = new Set(c.events.map((e) => e.id));

  const idSets: [string, string[]][] = [
    ['region', c.regions.map((r) => r.id)],
    ['node', c.nodes.map((n) => n.id)],
    ['road', c.roads.map((r) => r.id)],
    ['route', c.routes.map((r) => r.id)],
    ['colonia', c.culiacan.colonias.map((col) => col.id)],
    ['faction', c.factions.map((f) => f.id)],
    ['trait', c.traits.map((t) => t.id)],
    ['character', c.characters.map((ch) => ch.id)],
    ['message', c.messages.map((m) => m.id)],
    ['event', c.events.map((e) => e.id)],
  ];
  for (const [kind, ids] of idSets) {
    for (const d of duplicates(ids)) p.push(`duplicate ${kind} id "${d}"`);
  }

  for (const n of c.nodes) {
    if (!regionIds.has(n.region)) p.push(`map.json: node "${n.id}" has unknown region "${n.region}"`);
    if (n.owner !== null && !charIds.has(n.owner)) p.push(`map.json: node "${n.id}" has unknown owner "${n.owner}"`);
    if (n.type === 'border_exit' && n.owner !== null) p.push(`map.json: border exit "${n.id}" cannot have an owner`);
  }

  for (const r of c.roads) {
    if (!nodeIds.has(r.from)) p.push(`roads.json: road "${r.id}" has unknown from "${r.from}"`);
    if (!nodeIds.has(r.to)) p.push(`roads.json: road "${r.id}" has unknown to "${r.to}"`);
    if (r.from === r.to) p.push(`roads.json: road "${r.id}" is a loop`);
    for (const near of r.passesNear) {
      if (!nodeIds.has(near)) p.push(`roads.json: road "${r.id}" passes near unknown node "${near}"`);
    }
  }

  // Every node should be reachable from every other.
  if (c.nodes.length && c.roads.length) {
    const adj = new Map<string, string[]>();
    for (const r of c.roads) {
      adj.set(r.from, [...(adj.get(r.from) ?? []), r.to]);
      adj.set(r.to, [...(adj.get(r.to) ?? []), r.from]);
    }
    const first = c.nodes[0]!.id;
    const seen = new Set([first]);
    const queue = [first];
    while (queue.length) {
      for (const next of adj.get(queue.shift()!) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    for (const n of c.nodes) if (!seen.has(n.id)) p.push(`roads.json: node "${n.id}" is unreachable`);
  }

  for (const route of c.routes) {
    const where = `routes.json: route "${route.id}"`;
    for (const n of route.nodes) if (!nodeIds.has(n)) p.push(`${where} has unknown node "${n}"`);
    for (const d of duplicates(route.nodes)) p.push(`${where} visits "${d}" twice`);
    for (let i = 1; i < route.nodes.length; i++) {
      const a = route.nodes[i - 1]!;
      const b = route.nodes[i]!;
      if (!c.roads.some((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a))) p.push(`${where} has no road between "${a}" and "${b}"`);
    }
    const last = c.nodes.find((n) => n.id === route.nodes[route.nodes.length - 1]);
    if (last && last.type !== 'border_exit') p.push(`${where} must end at a border exit, not "${last.id}"`);
  }

  const cul = c.culiacan;
  if (!nodeIds.has(cul.parentNode)) p.push(`colonias.json: unknown parentNode "${cul.parentNode}"`);
  else if (!c.nodes.find((n) => n.id === cul.parentNode)?.hasSubmap)
    p.push(`colonias.json: parentNode "${cul.parentNode}" is not marked hasSubmap in map.json`);
  if (!factionIds.has(cul.positiveFaction)) p.push(`colonias.json: unknown positiveFaction "${cul.positiveFaction}"`);
  for (const s of cul.streets) {
    if (!coloniaIds.has(s.from)) p.push(`colonias.json: street from unknown colonia "${s.from}"`);
    if (!coloniaIds.has(s.to)) p.push(`colonias.json: street to unknown colonia "${s.to}"`);
  }

  const majors = c.factions.filter((f) => f.kind === 'major');
  if (majors.length !== 2) p.push(`factions.json: expected exactly 2 major factions, found ${majors.length}`);
  for (const f of c.factions) {
    if (f.kind === 'major' && f.head === null) p.push(`factions.json: major faction "${f.id}" needs a head`);
    if (f.head !== null) {
      const head = c.characters.find((ch) => ch.id === f.head);
      if (!head) p.push(`factions.json: faction "${f.id}" has unknown head "${f.head}"`);
      else if (head.faction !== f.id) p.push(`factions.json: head "${f.head}" does not belong to faction "${f.id}"`);
    }
  }

  for (const t of c.traits) {
    for (const o of t.opposites) if (!traitIds.has(o)) p.push(`traits.json: trait "${t.id}" has unknown opposite "${o}"`);
  }

  for (const ch of c.characters) {
    const where = `characters.json: "${ch.id}"`;
    if (!factionIds.has(ch.faction)) p.push(`${where} has unknown faction "${ch.faction}"`);
    if (ch.homePlaza !== null && !nodeIds.has(ch.homePlaza)) p.push(`${where} has unknown homePlaza "${ch.homePlaza}"`);
    for (const t of ch.traits) if (!traitIds.has(t)) p.push(`${where} has unknown trait "${t}"`);
    for (const d of duplicates(ch.traits)) p.push(`${where} lists trait "${d}" twice`);
    for (const t of ch.traits) {
      const opp = c.traits.find((tr) => tr.id === t)?.opposites ?? [];
      for (const o of opp) if (ch.traits.includes(o) && t < o) p.push(`${where} has opposite traits "${t}" and "${o}"`);
    }
    for (const r of ch.relations) if (!charIds.has(r.target)) p.push(`${where} has relation to unknown "${r.target}"`);
    if (ch.heir !== null && !charIds.has(ch.heir)) p.push(`${where} has unknown heir "${ch.heir}"`);
    if (ch.heir === ch.id) p.push(`${where} is their own heir`);
    if (ch.lean && !factionIds.has(ch.lean.faction)) p.push(`${where} leans to unknown faction "${ch.lean.faction}"`);
    for (const crew of ch.crews) {
      if (!nodeIds.has(crew.location)) p.push(`${where} has a crew at unknown node "${crew.location}"`);
      if (crew.colonia !== undefined) {
        if (crew.location !== c.culiacan.parentNode) p.push(`${where} has a crew committed to a colonia outside ${c.culiacan.parentNode}`);
        else if (!coloniaIds.has(crew.colonia)) p.push(`${where} has a crew in unknown colonia "${crew.colonia}"`);
      }
      if (crew.leader !== undefined && !charIds.has(crew.leader)) p.push(`${where} has a crew with unknown leader "${crew.leader}"`);
      const seats = Object.entries(crew.vehicles).reduce(
        (sum, [v, count]) => sum + c.tuning.vehicles[v as keyof Tuning['vehicles']].seats * (count ?? 0),
        0,
      );
      if (seats < crew.men) p.push(`${where} has a crew of ${crew.men} men but only ${seats} seats`);
    }
  }

  // Event effects that name other events, factions, or traits must point at real ones.
  const majorIds = new Set(c.factions.filter((f) => f.kind === 'major').map((f) => f.id));
  for (const ev of c.events) {
    for (const t of [ev.trigger.has_trait, ...ev.options.map((o) => o.conditions?.has_trait)]) {
      if (t !== undefined && !traitIds.has(t)) p.push(`events/${ev.id}: unknown trait "${t}"`);
    }
    for (const opt of ev.options) {
      for (const key of ['schedule_event', 'delay_event'] as const) {
        const target = opt.effects[key];
        if (target !== undefined && !eventIds.has(target))
          p.push(`events/${ev.id}: option "${opt.label}" ${key} targets unknown event "${target}"`);
      }
      const side = opt.effects.declare_alignment;
      if (side !== undefined && side !== 'neutral' && !majorIds.has(side))
        p.push(`events/${ev.id}: option "${opt.label}" declares for unknown faction "${side}"`);
    }
    if (ev.mean_days === undefined && !c.events.some((e) => e.options.some((o) => o.effects.schedule_event === ev.id)))
      p.push(`events/${ev.id}: has no mean_days and nothing schedules it, so it can never fire`);
  }

  const w = c.tuning.endings.scoreWeights;
  const sum = w.territory + w.wealth + w.standing + w.reputation + w.force;
  if (Math.abs(sum - 1) > 1e-9) p.push(`tuning.json: endings.scoreWeights sum to ${sum}, expected 1`);

  return p;
}
