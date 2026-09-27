/**
 * The single, plain, serializable game-state object. Everything the sim knows
 * lives here; the UI only reads it. No classes, Maps, Sets, or functions, so
 * JSON round-trips it exactly.
 */
import type { ExtortionRate, Goal, Rank, RelationType, RoadType, Skill, VehicleType } from '../data/schemas';
import type { RngState } from './rng';

export const SAVE_VERSION = 1;

export type Id = string;

export interface GameState {
  version: number;
  seed: number;
  rng: RngState;
  /** Absolute in-game hours since campaign start. One tick = one hour. */
  hour: number;
  playerId: Id;
  nodes: Record<Id, PlazaState>;
  colonias: Record<Id, ColoniaState>;
  characters: Record<Id, CharacterState>;
  crews: Record<Id, CrewState>;
  factions: Record<Id, FactionState>;
  regions: Record<Id, RegionState>;
  pacts: Pact[];
  schemes: Scheme[];
  reports: Report[];
  drones: Drone[];
  battles: Record<Id, Battle>;
  /** Events waiting for a decision. */
  pendingEvents: PendingEvent[];
  /** Events scheduled by other events' effects. */
  scheduledEvents: ScheduledEvent[];
  feed: FeedEntry[];
  ended: EndState | null;
  /** Counter for deterministic id generation. */
  nextId: number;
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export interface Claim {
  character: Id;
  strength: number;
}

export interface PlazaState {
  id: Id;
  /** Character id, or null. Culiacán's ownership lives in its colonias. */
  owner: Id | null;
  fortification: number;
  support: number;
  halconCoverage: number;
  businesses: number;
  labs: number;
  militaryPresence: number;
  extortionRate: ExtortionRate;
  claims: Claim[];
  /** Cash held in stash houses here. */
  stash: number;
}

export interface ColoniaState {
  id: Id;
  /** −100 … +100; sign follows content.culiacan.positiveFaction. */
  control: number;
}

export type WarState = 'quiet' | 'tense' | 'skirmishing' | 'offensive';

export interface RegionState {
  id: Id;
  calentura: number;
  warState: WarState;
  combatHoursToday: number;
  quietDays: number;
  /** Hour at which a commander bribe lapses, or null. */
  commanderBribedUntil: number | null;
  commanderRotatesAt: number;
}

// ---------------------------------------------------------------------------
// Characters and factions
// ---------------------------------------------------------------------------

export type CharacterStatus = 'free' | 'captured' | 'jailed' | 'dead' | 'extradited';

export interface OpinionModifier {
  /** Machine key, e.g. "helped_defend", "paid_late", "killed_brother". */
  key: string;
  value: number;
  addedAt: number;
  /** Linear decay to zero over this many days; null = permanent. */
  decayDays: number | null;
}

export interface Relation {
  type: RelationType;
  target: Id;
}

export interface CharacterState {
  id: Id;
  name: string;
  /** Nickname shown in the UI, if any. */
  alias: string | null;
  age: number;
  health: number;
  /** Faction the character is aligned with; null means neutral. */
  faction: Id | null;
  rank: Rank;
  homePlaza: Id | null;
  skills: Record<Skill, number>;
  traits: Id[];
  profile: number;
  goal: Goal;
  relations: Relation[];
  heir: Id | null;
  status: CharacterStatus;
  /** Hour the current status began (for extradition timers etc.). */
  statusSince: number;
  cash: number;
  fear: number;
  respect: number;
  credibility: number;
  /** State intel meter toward a capture operation. */
  stateIntel: number;
  /** Opinion this character holds of others, keyed by target id. Sparse. */
  opinions: Record<Id, OpinionModifier[]>;
  /** Opinion this character holds of each faction. */
  factionOpinions: Record<Id, OpinionModifier[]>;
  missedPayrollWeeks: number;
  /** Who holds this character, if captured. */
  captor: Id | null;
}

export type WarPlanMode = 'attack' | 'defend' | 'regroup';

export interface FactionState {
  id: Id;
  head: Id | null;
  supply: number;
  exhaustion: number;
  quietDays: number;
  combatHoursToday: number;
  warPlan: { mode: WarPlanMode; focusRegion: Id | null };
}

// ---------------------------------------------------------------------------
// Crews and movement
// ---------------------------------------------------------------------------

export type CrewLocation =
  | { kind: 'node'; node: Id }
  | { kind: 'road'; road: Id; from: Id; to: Id; progressKm: number };

export type RoutePreference = 'fastest' | 'balanced' | 'safest';

/** One road segment of a planned path, driven toward node `to`. */
export interface PathStep {
  road: Id;
  to: Id;
}

export type CrewOrder =
  | { type: 'idle' }
  | { type: 'garrison' }
  | { type: 'lie_low' }
  | {
      type: 'move';
      destination: Id;
      preference: RoutePreference;
      waypoints: Id[];
      path: PathStep[];
      /** Sync arrival: the crew waits at its start until this hour. */
      departAt: number | null;
      arriveAt: number | null;
    }
  /** Hold a point on a road; `atKm` is measured from the road's `from` node (null = midpoint). */
  | { type: 'ambush'; road: Id; atKm: number | null }
  | { type: 'patrol'; road: Id; atKm: number | null }
  | { type: 'raid'; target: Id; preference: RoutePreference; path: PathStep[] }
  | { type: 'reinforce'; battle: Id; path: PathStep[] }
  | { type: 'retreat'; destination: Id; path: PathStep[] }
  | { type: 'escort'; crew: Id };

export type DroneReaction = 'relocate' | 'ambush' | 'feign' | 'hold';

/** Bookkeeping for movement and detection; not player-facing. */
export interface CrewTransit {
  /** Breakdowns: no movement until this hour. */
  waitUntil: number | null;
  /** Nodes already rolled for on the current segment. */
  rolled: Id[];
  /** Last node rolled on approach this trip, so leaving it does not roll twice. */
  lastRolledNode: Id | null;
  /** Next hour a stationary crew in a watched spot rolls again. */
  nextStationaryRoll: number;
  /** A Calculador leader's delayed shift after spotting a drone. */
  shiftAt: number | null;
  /** Road to avoid when shifting. */
  shiftAvoidRoad: Id | null;
  /** Networks that spotted the group on approach to its current target node. */
  spotted: { node: Id; by: NetworkId[] } | null;
}

export interface CrewState {
  id: Id;
  /** Character the crew answers to (pays it). */
  owner: Id;
  /** Character leading it in the field. */
  leader: Id;
  men: number;
  skill: number;
  gear: number;
  morale: number;
  alertness: number;
  /** 0–100 percent of a full load. */
  ammo: number;
  fatigue: number;
  vehicles: Record<VehicleType, number>;
  /** Armored-truck damage 0–100, if any are present. */
  armorDamage: number;
  location: CrewLocation;
  order: CrewOrder;
  transit: CrewTransit;
  /** Battle the crew is fighting in, if any. Crews in battle do not move. */
  battle: Id | null;
  /** Culiacán colonia the crew is committed to (only while in Culiacán). */
  colonia: Id | null;
  /** Battles survived; skill grows with them. */
  battles: number;
}

// ---------------------------------------------------------------------------
// Intelligence
// ---------------------------------------------------------------------------

export type Confidence = 'confirmed' | 'estimated' | 'rumor';
export type ReportSource = 'halcon' | 'patrol' | 'drone' | 'rumor';

/**
 * A network is a faction id, or a neutral character's own id. Everyone in a
 * network shares halcones and reports.
 */
export type NetworkId = Id;

export interface Report {
  id: Id;
  network: NetworkId;
  crew: Id;
  /** Owner of the sighted crew, as far as the network can tell. */
  owner: Id;
  men: number;
  vehicles: Partial<Record<VehicleType, number>>;
  where: CrewLocation;
  roadType: RoadType | null;
  hour: number;
  confidence: Confidence;
  source: ReportSource;
  /** True if planted by a rival; the observer does not know this. */
  planted: boolean;
}

export interface Drone {
  id: Id;
  network: NetworkId;
  owner: Id;
  road: Id;
  launchedAt: number;
  until: number;
  /** Crews that already rolled to notice this drone. */
  rolled: Id[];
}

// ---------------------------------------------------------------------------
// Combat, diplomacy, schemes, events
// ---------------------------------------------------------------------------

export type EngagementType = 'ambush' | 'road_clash' | 'raid' | 'siege' | 'urban_skirmish' | 'military_clash';

export interface BattleSide {
  network: NetworkId;
  /** Crews still fighting. */
  crews: Id[];
  /** Everyone whose crews fought on this side, for the aftermath. */
  owners: Id[];
  /** Men lost so far. */
  casualties: number;
  /** Power at the last resolved hour, for the UI. */
  power: number;
  /** Faction help was already requested for this side. */
  helpCalled: boolean;
}

export interface Battle {
  id: Id;
  type: EngagementType;
  where: CrewLocation;
  /** Culiacán colonia, for urban skirmishes. */
  colonia: Id | null;
  region: Id;
  startedAt: number;
  hours: number;
  attackers: BattleSide;
  defenders: BattleSide;
  /** Defending plaza's fortification at the start (0 on roads). */
  fortification: number;
  /** Siege progress 0–100; effective fortification falls as it rises. */
  siegeProgress: number;
  /** Attackers win the plaza if they win the battle (raids and sieges). */
  capture: boolean;
  /** Player's crews withdrawing in good order this hour. */
  withdrawing: Id[];
  /** Player's crews pushing their armored trucks forward this hour. */
  armorPush: Id[];
  /** Prompts already shown, so each key moment pauses once. */
  prompted: ('enemy_wavering' | 'own_wavering')[];
  log: string[];
  endedAt: number | null;
  winner: 'attackers' | 'defenders' | null;
}

export type PactType = 'non_aggression' | 'safe_passage' | 'mutual_defense' | 'joint_attack' | 'route_share' | 'local_truce';

export interface Pact {
  id: Id;
  type: PactType;
  parties: [Id, Id];
  secret: boolean;
  expiresAt: number | null;
  region: Id | null;
}

export type SchemeType = 'flip' | 'assassinate' | 'frame' | 'leak_location' | 'buy_halcones' | 'compadrazgo';

export interface Scheme {
  id: Id;
  type: SchemeType;
  owner: Id;
  target: Id;
  progress: number;
  startedAt: number;
  discovered: boolean;
}

export interface PendingEvent {
  instance: Id;
  event: Id;
  /** Scope target id (character, plaza, faction, or region). */
  scope: Id;
  firedAt: number;
}

export interface ScheduledEvent {
  event: Id;
  scope: Id;
  at: number;
}

export type FeedTier = 'critical' | 'important' | 'routine';

export interface FeedEntry {
  id: Id;
  hour: number;
  tier: FeedTier;
  /** Network that sees this entry; null = everyone. */
  audience: NetworkId | null;
  /** Battle to open when clicked, if any. */
  battle: Id | null;
  text: string;
  /** Map location to jump to, if any. */
  node: Id | null;
}

export type EndReason = 'faction_collapse' | 'territorial_defeat' | 'negotiated_truce' | 'time_cap' | 'player_eliminated';

export interface EndState {
  reason: EndReason;
  hour: number;
  winner: Id | null;
}
