/** Small read-only helpers for the UI. */
import type { Content } from '../data/content';
import { kmFromRoadStart } from '../sim/crews';
import { networkOf } from '../sim/network';
import type { CrewLocation, CrewState, GameState, Id } from '../sim/state';
import { world } from '../sim/world';

export function playerNetwork(game: GameState): Id {
  return networkOf(game, game.playerId);
}

export function charLabel(game: GameState, id: Id): string {
  const c = game.characters[id];
  return c ? (c.alias ?? c.name) : id;
}

export function crewLabel(game: GameState, crew: CrewState): string {
  return `${charLabel(game, crew.leader)} · ${crew.men} men`;
}

export function vehicleSummary(v: Partial<Record<string, number>>): string {
  const short: Record<string, string> = { pickup: 'pickup', suv: 'SUV', motorcycle: 'moto', armored: 'armored' };
  return Object.entries(v)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([k, n]) => `${n} ${short[k] ?? k}${n === 1 || k === 'armored' ? '' : 's'}`)
    .join(', ');
}

/** SVG coordinates of a location on the state map. */
export function locationXY(content: Content, loc: CrewLocation): { x: number; y: number } {
  const w = world(content);
  if (loc.kind === 'node') {
    const n = w.node(loc.node);
    return { x: n.x, y: n.y };
  }
  const road = w.road(loc.road);
  const a = w.node(road.from);
  const b = w.node(road.to);
  const t = kmFromRoadStart(content, loc) / road.lengthKm;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function locationName(content: Content, loc: CrewLocation): string {
  const w = world(content);
  if (loc.kind === 'node') return w.node(loc.node).name;
  return `road to ${w.node(loc.to).name} (${Math.round(w.road(loc.road).lengthKm - loc.progressKm)} km left)`;
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min ? `${whole}h ${min}m` : `${whole}h`;
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
