/**
 * Movement and visibility math for groups of crews. Formulas are from the GDD
 * "Visibility and intelligence" section; every constant comes from tuning.
 */
import type { Content } from '../data/content';
import type { RoadType, Tuning, VehicleType } from '../data/schemas';
import type { CrewState, GameState } from './state';

export const VEHICLE_TYPES: readonly VehicleType[] = ['pickup', 'suv', 'motorcycle', 'armored'];
export const ROAD_TYPES: readonly RoadType[] = ['highway', 'paved', 'brecha'];

function vehiclesIn(crews: readonly CrewState[]): VehicleType[] {
  return VEHICLE_TYPES.filter((v) => crews.some((c) => c.vehicles[v] > 0));
}

/** Road types every vehicle in the group can use. */
export function allowedRoadTypes(crews: readonly CrewState[], tuning: Tuning): Set<RoadType> {
  const allowed = new Set<RoadType>(ROAD_TYPES);
  for (const v of vehiclesIn(crews)) {
    const ok = tuning.vehicles[v].roads;
    for (const r of ROAD_TYPES) if (!ok.includes(r)) allowed.delete(r);
  }
  return allowed;
}

/** Group speed on a road type: the slowest vehicle sets the pace. */
export function groupSpeedKmh(crews: readonly CrewState[], roadType: RoadType, tuning: Tuning): number {
  const factor = tuning.roads[roadType].speed;
  const types = vehiclesIn(crews);
  if (types.length === 0) return 0;
  return Math.min(
    ...types.map((v) => {
      const t = tuning.vehicles[v];
      return t.baseSpeedKmh * factor * (roadType === 'brecha' ? (t.brechaSpeedMultiplier ?? 1) : 1);
    }),
  );
}

export function vehicleSignature(crews: readonly CrewState[], tuning: Tuning): number {
  let sum = 0;
  for (const c of crews) for (const v of VEHICLE_TYPES) sum += c.vehicles[v] * tuning.vehicles[v].signature;
  return sum;
}

/** Product of per-crew stealth, weighted by each crew's share of the signature. */
function stealthMultiplier(state: GameState, content: Content, crews: readonly CrewState[]): number {
  const { tuning } = content;
  const total = vehicleSignature(crews, tuning);
  if (total === 0) return 1;
  let weighted = 0;
  for (const c of crews) {
    const share = vehicleSignature([c], tuning) / total;
    let m = tuning.detection.stealthBySkill[Math.min(5, Math.max(1, c.skill)) - 1]!;
    for (const t of state.characters[c.leader]?.traits ?? []) {
      m *= content.traits.find((tr) => tr.id === t)?.modifiers.signatureMultiplier ?? 1;
    }
    weighted += share * m;
  }
  return weighted;
}

export interface SignatureInput {
  /** Road visibility factor, or the stationary stand-in for a crew in a node. */
  visibility: number;
  night: boolean;
  /** Regional calentura at the observed spot. */
  calentura: number;
}

/**
 * Signature = Σ vehicle signature × road visibility × night × crew stealth,
 * then × the occupation multiplier at very high calentura.
 */
export function signature(state: GameState, content: Content, crews: readonly CrewState[], input: SignatureInput): number {
  const { tuning } = content;
  if (crews.every((c) => c.order.type === 'lie_low')) return 0;
  let sig = vehicleSignature(crews, tuning) * input.visibility * stealthMultiplier(state, content, crews);
  if (input.night) sig *= tuning.clock.nightSignatureMultiplier;
  if (crews.every((c) => c.order.type === 'ambush')) sig *= tuning.detection.ambushSignatureMultiplier;
  if (input.calentura >= tuning.state.tiers.occupation) sig *= tuning.state.occupationSignatureMultiplier;
  return sig;
}

/** P(detect) = clamp(signature × coverage/100 × k, min, max). Zero signature is never seen. */
export function detectionChance(sig: number, coverage: number, tuning: Tuning): number {
  if (sig <= 0 || coverage <= 0) return 0;
  const { coefficient, minChance, maxChance } = tuning.detection;
  return Math.min(maxChance, Math.max(minChance, sig * (coverage / 100) * coefficient));
}

export function seats(crew: Pick<CrewState, 'vehicles'>, tuning: Tuning): number {
  return VEHICLE_TYPES.reduce((n, v) => n + crew.vehicles[v] * tuning.vehicles[v].seats, 0);
}
