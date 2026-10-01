/**
 * Combat strength and engagement decisions (GDD "Combat"). Decisions that
 * depend on what a side knows take their enemy estimate as input, so callers
 * choose between true values (close contact) and report estimates.
 */
import { crewEstimate } from './knowledge';
import type { Content } from '../data/content';
import type { CrewState, GameState, Id, NetworkId } from './state';

function traitModifier(state: GameState, content: Content, character: Id, key: string): number {
  let m = 1;
  for (const t of state.characters[character]?.traits ?? []) m *= content.traits.find((tr) => tr.id === t)?.modifiers[key] ?? 1;
  return m;
}

/**
 * Power = men × (0.6 + 0.2 skill) × (0.6 + 0.2 gear) × (0.5 + 0.5 morale/100),
 * then the leader's Violencia and the crew's fatigue. Armored trucks add
 * their flat power on top.
 */
export function crewPower(state: GameState, content: Content, crew: CrewState, armorMultiplier = 1): number {
  const c = content.tuning.combat;
  if (crew.men <= 0) return 0;
  let p =
    crew.men *
    (c.powerSkillBase + c.powerSkillPerLevel * crew.skill) *
    (c.powerGearBase + c.powerGearPerLevel * crew.gear) *
    (c.powerMoraleBase + c.powerMoraleScale * (crew.morale / 100));
  const violencia = state.characters[crew.leader]?.skills.violencia ?? 10;
  p *= 1 + (violencia - 10) * c.violenciaBonusPerPoint;
  p *= 1 - (crew.fatigue / 100) * c.fatiguePowerPenalty;
  p += crew.vehicles.armored * (content.tuning.vehicles.armored.combatPower ?? 0) * armorMultiplier;
  return Math.max(0, p);
}

export function groupPower(state: GameState, content: Content, crews: readonly CrewState[]): number {
  return crews.reduce((sum, c) => sum + crewPower(state, content, c), 0);
}

/** Caution of the leader of the largest crew (trait "caution" modifiers; 1 = neutral). */
export function caution(state: GameState, content: Content, crews: readonly CrewState[]): number {
  const lead = [...crews].sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1))[0];
  return lead ? traitModifier(state, content, lead.leader, 'caution') : 1;
}

/** Leader trait multiplier for a battle situation, e.g. "ambushPower" or "siegePower". */
export function leaderModifier(state: GameState, content: Content, crew: CrewState, key: string): number {
  return traitModifier(state, content, crew.leader, key);
}

/** Would this force attack an enemy it believes has `enemyPower`? */
export function wantsToAttack(state: GameState, content: Content, own: readonly CrewState[], enemyPower: number): boolean {
  const mine = groupPower(state, content, own);
  if (mine <= 0) return false;
  return mine >= content.tuning.combat.engageRatio * caution(state, content, own) * enemyPower;
}

/** Enemy strength as a network's reports describe it (men × a flat per-man estimate). */
export function reportedPower(state: GameState, content: Content, network: NetworkId, crews: readonly CrewState[]): number {
  const fade = content.tuning.detection.lastSeenFadeHours;
  let men = 0;
  for (const crew of crews) men += crewEstimate(state, content, network, crew.id, fade)?.men ?? 0;
  return men * content.tuning.combat.estimatedPowerPerMan;
}
