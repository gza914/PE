/** Builds the day-0 game state from validated content. */
import type { Content } from '../data/content';
import type { VehicleType } from '../data/schemas';
import { newId } from './context';
import { seedRng } from './rng';
import { SAVE_VERSION, type CharacterState, type CrewState, type CrewTransit, type GameState, type OpinionModifier } from './state';

export interface NewGameOptions {
  seed: number;
  playerId: string;
}

export function newTransit(): CrewTransit {
  return { waitUntil: null, rolled: [], lastRolledNode: null, nextStationaryRoll: 0, shiftAt: null, shiftAvoidRoad: null };
}

export const NO_VEHICLES: Record<VehicleType, number> = { pickup: 0, suv: 0, motorcycle: 0, armored: 0 };

export function newGame(content: Content, opts: NewGameOptions): GameState {
  const { tuning } = content;
  const player = content.characters.find((c) => c.id === opts.playerId);
  if (!player) throw new Error(`unknown player character "${opts.playerId}"`);
  if (player.startTier === null) throw new Error(`"${opts.playerId}" is not a playable start`);

  const state: GameState = {
    version: SAVE_VERSION,
    seed: opts.seed,
    rng: seedRng(opts.seed),
    hour: 0,
    playerId: opts.playerId,
    nodes: {},
    colonias: {},
    characters: {},
    crews: {},
    factions: {},
    regions: {},
    pacts: [],
    schemes: [],
    reports: [],
    drones: [],
    battles: {},
    pendingEvents: [],
    scheduledEvents: [],
    feed: [],
    ended: null,
    nextId: 1,
  };

  for (const n of content.nodes) {
    state.nodes[n.id] = {
      id: n.id,
      owner: n.owner,
      fortification: n.fortification,
      support: n.support,
      halconCoverage: n.halconCoverage,
      businesses: n.businesses,
      labs: n.labs,
      militaryPresence: n.militaryPresence,
      extortionRate: n.extortionRate,
      claims: [],
      stash: 0,
    };
  }

  for (const col of content.culiacan.colonias) state.colonias[col.id] = { id: col.id, control: col.control };

  for (const r of content.regions) {
    state.regions[r.id] = {
      id: r.id,
      calentura: tuning.state.startingCalentura,
      warState: 'tense',
      combatHoursToday: 0,
      quietDays: 0,
      commanderBribedUntil: null,
      commanderRotatesAt: tuning.state.commanderRotationDays * 24,
    };
  }

  for (const f of content.factions) {
    state.factions[f.id] = {
      id: f.id,
      head: f.head,
      supply: tuning.pulse.startingSupply,
      exhaustion: tuning.pulse.startingExhaustion,
      quietDays: 0,
      warPlan: { mode: 'defend', focusRegion: null },
    };
  }

  for (const def of content.characters) {
    const factionOpinions: Record<string, OpinionModifier[]> = {};
    if (def.lean) {
      factionOpinions[def.lean.faction] = [{ key: 'starting_lean', value: def.lean.amount, addedAt: 0, decayDays: null }];
    }
    const ch: CharacterState = {
      id: def.id,
      name: def.name,
      alias: def.alias,
      age: def.age,
      health: def.health,
      faction: def.faction,
      rank: def.rank,
      homePlaza: def.homePlaza,
      skills: { ...def.skills },
      traits: [...def.traits],
      profile: def.profile,
      goal: def.goal,
      relations: def.relations.map((r) => ({ ...r })),
      heir: def.heir,
      status: 'free',
      statusSince: 0,
      cash: def.cash,
      fear: 0,
      respect: 0,
      credibility: 50,
      stateIntel: 0,
      opinions: {},
      factionOpinions,
      missedPayrollWeeks: 0,
    };
    state.characters[def.id] = ch;

    for (const c of def.crews) {
      const id = newId(state, 'crew');
      const crew: CrewState = {
        id,
        owner: def.id,
        leader: c.leader ?? def.id,
        men: c.men,
        skill: c.skill,
        gear: c.gear,
        morale: tuning.crews.startingMorale,
        alertness: tuning.crews.startingAlertness,
        ammo: 100,
        fatigue: 0,
        vehicles: { ...NO_VEHICLES, ...c.vehicles },
        armorDamage: 0,
        location: { kind: 'node', node: c.location },
        order: { type: 'garrison' },
        transit: newTransit(),
      };
      state.crews[id] = crew;
    }
  }

  return state;
}
