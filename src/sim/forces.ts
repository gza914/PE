/**
 * Recruitment depth and formations (GDD "Recruitment", "Formations"):
 * named tiers, weapons as their own purchase, training camps, hired veterans,
 * mercenaries, pay by tier, and columns of two crews.
 */
import type { Tuning } from '../data/schemas';
import { newId, pushFeed, type SimContext } from './context';
import { escortsOf } from './crews';
import { spend } from './money';
import { networkOf } from './network';
import { newTransit } from './newGame';
import { charName } from './orders';
import { chance } from './rng';
import { seats } from './signature';
import type { CrewState, GameState, Id } from './state';
import { world } from './world';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function skillName(tuning: Tuning, skill: number): string {
  return tuning.forces.skillNames[Math.max(1, Math.min(5, Math.round(skill))) - 1]!;
}

export function gearName(tuning: Tuning, gear: number): string {
  return tuning.forces.gearNames[Math.max(1, Math.min(5, Math.round(gear))) - 1]!;
}

/** "Sicarios with AR-15s". */
export function tierLabel(tuning: Tuning, crew: Pick<CrewState, 'skill' | 'gear'>): string {
  return `${skillName(tuning, crew.skill)} · ${gearName(tuning, crew.gear)}`;
}

/** One crew's weekly pay: more for better men, more again for hired troops. */
export function crewPayPerWeek(tuning: Tuning, crew: CrewState): number {
  const bySkill = tuning.forces.payBySkill[Math.max(1, Math.min(5, Math.round(crew.skill))) - 1]!;
  return crew.men * tuning.economy.payrollPerManPerWeek * bySkill * (crew.hired?.payMultiplier ?? 1);
}

/** Why `crew` cannot join `target` as a column, or null. */
export function columnBlocked(state: GameState, tuning: Tuning, crew: CrewState, target: CrewState): string | null {
  const c = tuning.forces.column;
  const others = escortsOf(state, target).filter((e) => e.id !== crew.id);
  if (others.length + 2 > c.maxCrews) return `a column is at most ${c.maxCrews} crews`;
  const men = target.men + crew.men + others.reduce((n, e) => n + e.men, 0);
  if (men > c.maxMen) return `a column is at most ${c.maxMen} men`;
  return null;
}

function ownPlazaOf(state: GameState, crew: CrewState): Id | null {
  if (crew.location.kind !== 'node') return null;
  const node = crew.location.node;
  return state.nodes[node]?.owner === crew.owner ? node : null;
}

/** Daily cost of training a crew where it stands. */
export function trainingCostPerDay(ctx: SimContext, crew: CrewState, node: Id): number {
  const t = ctx.content.tuning.forces.training;
  const sierra = t.sierraRegions.includes(world(ctx.content).node(node).region);
  return crew.men * t.costPerManPerDay * (sierra ? t.sierraCostMultiplier : 1);
}

export function trainingBlocked(ctx: SimContext, issuer: Id, crew: CrewState | undefined): string | null {
  const { state, content } = ctx;
  if (!crew || crew.owner !== issuer) return 'not your crew';
  if (crew.battle !== null) return 'that crew is in a battle';
  if (crew.order.type === 'escort') return 'break up the column first';
  if (!ownPlazaOf(state, crew)) return 'crews train only in a plaza you hold';
  if (crew.location.kind === 'node' && crew.location.node === content.culiacan.parentNode) return 'no camps inside Culiacán';
  if (crew.skill >= content.tuning.forces.training.maxSkill) return `training goes no further than ${skillName(content.tuning, content.tuning.forces.training.maxSkill)}; battles do the rest`;
  if (crew.training) return 'already training';
  return null;
}

export function trainCrew(ctx: SimContext, issuer: Id, crewId: Id): string | null {
  const crew = ctx.state.crews[crewId];
  const blocked = trainingBlocked(ctx, issuer, crew);
  if (blocked) return blocked;
  const node = ownPlazaOf(ctx.state, crew!)!;
  crew!.order = { type: 'garrison' };
  crew!.training = { node, since: ctx.state.hour, progress: 0 };
  return null;
}

export function stopTraining(ctx: SimContext, issuer: Id, crewId: Id): string | null {
  const crew = ctx.state.crews[crewId];
  if (!crew || crew.owner !== issuer) return 'not your crew';
  if (!crew.training) return 'that crew is not training';
  crew.training = null;
  return null;
}

/** Upgrade a crew's weapons to `gear`, paying the difference per man. */
export function buyWeapons(ctx: SimContext, issuer: Id, crewId: Id, gear: number): string | null {
  const { state, content } = ctx;
  const crew = state.crews[crewId];
  if (!crew || crew.owner !== issuer) return 'not your crew';
  if (!ownPlazaOf(state, crew)) return 'weapons are bought in a plaza you hold';
  if (!Number.isInteger(gear) || gear < 1 || gear > 5) return 'gear is 1–5';
  if (gear <= crew.gear) return `they already carry ${gearName(content.tuning, crew.gear)}`;
  const cost = weaponsCost(content.tuning, crew, gear);
  if (!spend(state, content, issuer, cost, 'weapons')) return `arming them costs ${money(cost)}`;
  crew.gear = gear;
  return null;
}

export function weaponsCost(tuning: Tuning, crew: Pick<CrewState, 'men' | 'gear'>, gear: number): number {
  const c = tuning.forces.weapons.costPerManByGear;
  return crew.men * Math.max(0, c[gear - 1]! - c[Math.max(1, Math.min(5, Math.round(crew.gear))) - 1]!);
}

/** Ex-soldiers and ex-police join a crew: skilled at once, few at a time. */
export function hireVeterans(ctx: SimContext, issuer: Id, crewId: Id, men: number): string | null {
  const { state, content } = ctx;
  const v = content.tuning.forces.veterans;
  const crew = state.crews[crewId];
  if (!crew || crew.owner !== issuer) return 'not your crew';
  if (crew.battle !== null) return 'that crew is in a battle';
  if (!ownPlazaOf(state, crew)) return 'veterans sign on in a plaza you hold';
  if (!Number.isInteger(men) || men < 1) return 'hire at least one';
  if (men > state.market.veterans) return `only ${state.market.veterans} veterans are looking for work this week`;
  if (crew.men + men > content.tuning.crews.maxMen) return `a crew holds at most ${content.tuning.crews.maxMen} men`;
  if (seats(crew, content.tuning) < crew.men + men) return 'not enough seats: buy vehicles first';
  if (!spend(state, content, issuer, men * v.costPerMan, 'recruits')) return `${men} veterans cost ${money(men * v.costPerMan)}`;
  state.market.veterans -= men;
  const total = crew.men + men;
  crew.skill = Math.round((crew.skill * crew.men + v.skill * men) / total);
  crew.gear = Math.round((crew.gear * crew.men + Math.max(crew.gear, v.gear) * men) / total);
  crew.men = total;
  crew.establishment = Math.max(crew.establishment, total);
  return null;
}

/** Guns from outside Sinaloa: a crew of their own, fast and dear; they leave when the money stops. */
export function hireMercenaries(ctx: SimContext, issuer: Id, node: Id, men: number): string | null {
  const { state, content } = ctx;
  const m = content.tuning.forces.mercenaries;
  if (state.nodes[node]?.owner !== issuer) return 'mercenaries report to a plaza you hold';
  if (!Number.isInteger(men) || men < m.minMen || men > Math.min(m.maxMen, content.tuning.crews.maxMen)) return `a mercenary band is ${m.minMen}–${Math.min(m.maxMen, content.tuning.crews.maxMen)} men`;
  const pickups = Math.ceil(men / content.tuning.vehicles.pickup.seats);
  const cost = men * m.costPerMan;
  if (!spend(state, content, issuer, cost, 'mercenaries')) return `${men} mercenaries cost ${money(cost)}`;
  const id = newId(state, 'crew');
  state.crews[id] = {
    id,
    owner: issuer,
    leader: issuer,
    men,
    skill: m.skill,
    gear: m.gear,
    morale: content.tuning.crews.startingMorale,
    alertness: content.tuning.crews.startingAlertness,
    ammo: 100,
    fatigue: 0,
    vehicles: { pickup: pickups, suv: 0, motorcycle: 0, armored: 0 },
    armorDamage: 0,
    location: { kind: 'node', node },
    order: { type: 'garrison' },
    transit: newTransit(),
    battle: null,
    colonia: null,
    battles: 0,
    establishment: men,
    training: null,
    hired: { kind: 'mercenary', from: null, loyalty: 100, payMultiplier: m.payMultiplier },
  };
  return null;
}

/** Daily: camps cost money, raise calentura, teach, and get talked about. */
export function runTrainingDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.forces.training;
  const w = world(content);
  for (const id of Object.keys(state.crews).sort()) {
    const crew = state.crews[id]!;
    const tr = crew.training;
    if (!tr) continue;
    const here = crew.location.kind === 'node' && crew.location.node === tr.node;
    if (!here || crew.battle !== null || crew.order.type !== 'garrison' || state.nodes[tr.node]?.owner !== crew.owner || crew.skill >= t.maxSkill) {
      crew.training = null;
      continue;
    }
    const cost = trainingCostPerDay(ctx, crew, tr.node);
    if (!spend(state, content, crew.owner, cost, 'training')) {
      crew.training = null;
      if (crew.owner === state.playerId) pushFeed(state, 'important', `No money for the camp in ${w.node(tr.node).name}: ${charName(ctx, crew.leader)}'s crew stopped training.`, tr.node, networkOf(state, crew.owner));
      continue;
    }
    const region = state.regions[w.node(tr.node).region];
    if (region) region.calentura = Math.min(100, region.calentura + t.calenturaPerDay);
    tr.progress += 1 / t.daysPerLevel[Math.max(1, Math.round(crew.skill)) - 1]!;
    if (tr.progress >= 1 - 1e-9) {
      crew.skill = Math.min(5, Math.round(crew.skill) + 1);
      tr.progress = 0;
      if (crew.owner === state.playerId) pushFeed(state, 'important', `${charName(ctx, crew.leader)}'s crew finished a stretch at the camp in ${w.node(tr.node).name}: now ${skillName(content.tuning, crew.skill)}.`, tr.node, networkOf(state, crew.owner));
      if (crew.skill >= t.maxSkill) crew.training = null;
    }
    // Word of a camp gets around.
    for (const f of content.factions) {
      if (f.kind !== 'major' || f.id === networkOf(state, crew.owner)) continue;
      if (!chance(state.rng, t.discoveryChancePerDay)) continue;
      pushFeed(state, 'routine', `Word is ${charName(ctx, crew.owner)} runs a training camp in ${w.node(tr.node).name}.`, tr.node, f.id);
      state.reports.push({
        id: newId(state, 'rep'),
        network: f.id,
        crew: crew.id,
        owner: crew.owner,
        men: crew.men,
        low: Math.max(1, Math.floor(crew.men * 0.5)),
        high: Math.ceil(crew.men * 1.5),
        vehicles: {},
        where: { kind: 'node', node: tr.node },
        roadType: null,
        hour: state.hour,
        confidence: 'rumor',
        source: 'rumor',
        planted: false,
      });
    }
  }
}

/** Weekly: veterans come on the market. */
export function restockVeterans(state: GameState, tuning: Tuning): void {
  const v = tuning.forces.veterans;
  state.market.veterans = Math.min(v.max, state.market.veterans + v.perWeek);
}

/** Missed pay: mercenaries walk at once, with their guns and trucks. */
export function mercenariesLeave(ctx: SimContext, owner: Id): void {
  const { state } = ctx;
  for (const id of Object.keys(state.crews).sort()) {
    const c = state.crews[id]!;
    if (c.owner !== owner || c.hired?.kind !== 'mercenary' || c.battle !== null) continue;
    for (const e of escortsOf(state, c)) e.order = { type: 'idle' };
    delete state.crews[id];
    if (owner === state.playerId) pushFeed(state, 'critical', `Unpaid, ${c.men} mercenaries packed up and left.`, c.location.kind === 'node' ? c.location.node : c.location.to, networkOf(state, owner));
  }
}
