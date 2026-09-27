/**
 * Zod schemas for every content file. Content is data, validated at load, so
 * mistakes in JSON fail loudly instead of surfacing as odd behavior mid-game.
 * See docs/GDD.md, "Technical architecture for Claude Code".
 */
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9_]+$/, 'ids are lowercase snake_case');
const pct = z.number().min(0).max(1);
const meter = z.number().min(0).max(100);

// ---------------------------------------------------------------------------
// Enums shared by content and state
// ---------------------------------------------------------------------------

export const NodeType = z.enum(['city', 'town', 'rancheria', 'sierra_hub', 'port', 'border_exit']);
export const RoadType = z.enum(['highway', 'paved', 'brecha']);
export const Terrain = z.enum(['open_valley', 'sugarcane', 'hills', 'sierra', 'urban']);
export const VehicleType = z.enum(['pickup', 'suv', 'motorcycle', 'armored']);
export const ExtortionRate = z.enum(['low', 'medium', 'high', 'brutal']);
export const Skill = z.enum(['violencia', 'astucia', 'negocio', 'palabra']);
export const Rank = z.enum(['head', 'inner_circle', 'senior_lieutenant', 'lieutenant', 'associate', 'crew_leader']);
export const StartTier = z.enum(['faction_head', 'city_boss', 'town_jefe']);
export const Goal = z.enum(['take_plaza', 'rise_in_faction', 'get_rich', 'stay_alive', 'avenge']);
export const RelationType = z.enum(['parent', 'child', 'sibling', 'spouse', 'compadre', 'rival', 'vendetta']);
export const EventScope = z.enum(['character', 'plaza', 'faction', 'region']);
export const MessageKind = z.enum(['narcomanta', 'video', 'social_claim', 'corrido', 'rumor']);

export type NodeType = z.infer<typeof NodeType>;
export type RoadType = z.infer<typeof RoadType>;
export type Terrain = z.infer<typeof Terrain>;
export type VehicleType = z.infer<typeof VehicleType>;
export type ExtortionRate = z.infer<typeof ExtortionRate>;
export type Skill = z.infer<typeof Skill>;
export type Rank = z.infer<typeof Rank>;
export type Goal = z.infer<typeof Goal>;
export type RelationType = z.infer<typeof RelationType>;

// ---------------------------------------------------------------------------
// map.json
// ---------------------------------------------------------------------------

export const RegionSchema = z.object({
  id,
  name: z.string(),
});

export const MapNodeSchema = z.object({
  id,
  name: z.string(),
  type: NodeType,
  region: id,
  /** Schematic SVG position, not GIS. */
  x: z.number(),
  y: z.number(),
  /** Character id of the starting owner, or null for unowned. */
  owner: id.nullable(),
  fortification: z.number().int().min(0).max(3).default(0),
  support: meter.default(50),
  halconCoverage: meter.default(0),
  businesses: z.number().int().min(0).default(0),
  labs: z.number().int().min(0).default(0),
  militaryPresence: z.number().int().min(0).max(3).default(0),
  extortionRate: ExtortionRate.default('medium'),
  /** Culiacán is a sub-map; its node links to colonias.json. */
  hasSubmap: z.boolean().default(false),
});

export const MapFileSchema = z.object({
  regions: z.array(RegionSchema).min(1),
  nodes: z.array(MapNodeSchema).min(1),
});

// ---------------------------------------------------------------------------
// roads.json
// ---------------------------------------------------------------------------

export const RoadSchema = z.object({
  id,
  from: id,
  to: id,
  type: RoadType,
  lengthKm: z.number().positive(),
  /** Nodes the segment passes near, for halcón coverage along the road. */
  passesNear: z.array(id).default([]),
  terrain: Terrain,
});

export const RoadsFileSchema = z.object({ roads: z.array(RoadSchema).min(1) });

// ---------------------------------------------------------------------------
// colonias.json (Culiacán sub-map)
// ---------------------------------------------------------------------------

export const ColoniaSchema = z.object({
  id,
  name: z.string(),
  x: z.number(),
  y: z.number(),
  /** −100 fully Mayos-side … +100 fully Chapitos-side. */
  control: z.number().min(-100).max(100),
  businesses: z.number().int().min(0).default(0),
});

export const StreetSchema = z.object({ from: id, to: id });

export const ColoniasFileSchema = z.object({
  /** The map node that hosts the sub-map. */
  parentNode: id,
  /** Faction whose control is positive (+100). The other major faction is negative. */
  positiveFaction: id,
  colonias: z.array(ColoniaSchema).min(1),
  streets: z.array(StreetSchema),
});

// ---------------------------------------------------------------------------
// factions.json
// ---------------------------------------------------------------------------

export const FactionSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['major', 'outside']),
  playable: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Character id of the faction head (major factions only). */
  head: id.nullable(),
  description: z.string().default(''),
});

export const FactionsFileSchema = z.object({ factions: z.array(FactionSchema).min(2) });

// ---------------------------------------------------------------------------
// traits.json
// ---------------------------------------------------------------------------

export const TraitSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  skillModifiers: z.partialRecord(Skill, z.number()).default({}),
  /**
   * Named numeric hooks systems read (e.g. "signatureMultiplier",
   * "opinionDecayMultiplier", "caution"). Unknown keys are allowed so new
   * systems can add hooks without schema churn.
   */
  modifiers: z.record(z.string(), z.number()).default({}),
  /** Reaction to a spotted drone (GDD "Drones"). */
  droneReaction: z.enum(['relocate', 'ambush', 'feign', 'hold']).optional(),
  opposites: z.array(id).default([]),
});

export const TraitsFileSchema = z.object({ traits: z.array(TraitSchema).min(1) });

// ---------------------------------------------------------------------------
// characters.json
// ---------------------------------------------------------------------------

const vehicles = z.partialRecord(VehicleType, z.number().int().min(0)).default({});

export const StartingCrewSchema = z.object({
  /** Crew leader; if omitted the owning character leads it. */
  leader: id.optional(),
  location: id,
  men: z.number().int().min(4).max(40),
  skill: z.number().int().min(1).max(5),
  gear: z.number().int().min(1).max(5),
  vehicles,
});

export const RelationSchema = z.object({ type: RelationType, target: id });

export const CharacterSchema = z.object({
  id,
  name: z.string(),
  age: z.number().int().min(14).max(99),
  health: meter.default(100),
  faction: id,
  rank: Rank,
  homePlaza: id.nullable(),
  skills: z.object({
    violencia: z.number().int().min(0).max(20),
    astucia: z.number().int().min(0).max(20),
    negocio: z.number().int().min(0).max(20),
    palabra: z.number().int().min(0).max(20),
  }),
  traits: z.array(id).min(1).max(5),
  profile: meter,
  goal: Goal,
  relations: z.array(RelationSchema).default([]),
  heir: id.nullable().default(null),
  /** Opinion bonus toward a faction at start (GDD "Opening choice"). */
  lean: z.object({ faction: id, amount: z.number().min(0).max(100) }).nullable().default(null),
  /** Present if the character can be picked on the character-select screen. */
  startTier: StartTier.nullable().default(null),
  cash: z.number().min(0).default(0),
  crews: z.array(StartingCrewSchema).default([]),
});

export const CharactersFileSchema = z.object({ characters: z.array(CharacterSchema).min(1) });

// ---------------------------------------------------------------------------
// messages.json (information warfare library)
// ---------------------------------------------------------------------------

export const MessageTemplateSchema = z.object({
  id,
  kind: MessageKind,
  /** Text with {variable} placeholders, e.g. "{target.name}". */
  text: z.string(),
  tags: z.array(z.string()).default([]),
});

export const MessagesFileSchema = z.object({ messages: z.array(MessageTemplateSchema) });

// ---------------------------------------------------------------------------
// events/*.json (Paradox-style events). Snake case matches the GDD example.
// ---------------------------------------------------------------------------

const conditions = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]));
const effects = z.record(z.string(), z.union([z.number(), z.boolean(), z.string()]));

export const EventOptionSchema = z.object({
  label: z.string(),
  conditions: conditions.optional(),
  effects: effects.default({}),
  ai_weight: z.number().min(0).default(1),
});

export const EventSchema = z.object({
  id,
  scope: EventScope,
  /** Events in the same chain never fire back to back. */
  chain: id.optional(),
  trigger: conditions,
  /** Mean time to happen, in days. Omit for events only fired by other events. */
  mean_days: z.number().positive().optional(),
  title: z.string(),
  text: z.string(),
  options: z.array(EventOptionSchema).min(2).max(4),
});

// ---------------------------------------------------------------------------
// tuning.json. Every balance number lives here, never in code.
// ---------------------------------------------------------------------------

const roadTuning = z.object({
  speed: z.number().positive(),
  visibility: z.number().positive(),
  checkpointChance: pct,
  breakdownChancePerSegment: pct.optional(),
});

const vehicleTuning = z.object({
  seats: z.number().int().positive(),
  signature: z.number().nonnegative(),
  cost: z.number().nonnegative(),
  roads: z.array(RoadType).min(1),
  baseSpeedKmh: z.number().positive(),
  combatPower: z.number().nonnegative().optional(),
});

const extortionTuning = z.object({
  incomePerBusinessPerDay: z.number(),
  supportPerWeek: z.number(),
  businessClosurePerWeek: pct,
});

export const TuningSchema = z.object({
  clock: z.object({
    startDate: z.iso.date(),
    maxDays: z.number().int().positive(),
    realMsPerHourBySpeed: z.array(z.number().positive()).length(5),
    nightStartHour: z.number().int().min(0).max(23),
    nightEndHour: z.number().int().min(0).max(23),
    nightSignatureMultiplier: z.number().positive(),
    nightBrechaBreakdownMultiplier: z.number().positive(),
    payrollWeekday: z.number().int().min(0).max(6),
    payrollHour: z.number().int().min(0).max(23),
    incomeSettleHour: z.number().int().min(0).max(23),
  }),
  pulse: z.object({
    exhaustionDecayPerQuietDay: z.number(),
    aiNoMajorOffensiveAboveExhaustion: meter,
    allOffensivesHaltAtExhaustion: meter,
    culiacanMinSkirmishesPerDay: z.number().nonnegative(),
    startingSupply: meter,
    startingExhaustion: meter,
    /** A day counts as quiet for a region or faction at or below this many combat hours. */
    quietDayMaxCombatHours: z.number().nonnegative(),
  }),
  map: z.object({
    coloniaFlipThreshold: z.number().min(0).max(100),
    halconRoadCoverageKm: z.number().nonnegative(),
  }),
  roads: z.object({ highway: roadTuning, paved: roadTuning, brecha: roadTuning }),
  vehicles: z.object({ pickup: vehicleTuning, suv: vehicleTuning, motorcycle: vehicleTuning, armored: vehicleTuning }),
  detection: z.object({
    coefficient: z.number().positive(),
    minChance: pct,
    maxChance: pct,
    eliteStealthMultiplier: z.number().positive(),
    lastSeenFadeHours: z.number().positive(),
    droneRevealHours: z.number().positive(),
    droneNoticeAlertnessFactor: z.number().nonnegative(),
    droneCost: z.number().nonnegative(),
  }),
  crews: z.object({
    minMen: z.number().int().positive(),
    maxMen: z.number().int().positive(),
    moraleBreakThreshold: meter,
    ammoHoursOfFighting: z.number().positive(),
    startingMorale: meter,
    startingAlertness: meter,
  }),
  combat: z.object({
    casualtyRatePerHour: pct,
    randomFactorMin: z.number().positive(),
    randomFactorMax: z.number().positive(),
    retreatMorale: meter,
    routMorale: meter,
    ambushFirstHourMultiplier: z.number().positive(),
    fortificationBonusPerLevel: z.number().nonnegative(),
    powerSkillBase: z.number(),
    powerSkillPerLevel: z.number(),
    powerGearBase: z.number(),
    powerGearPerLevel: z.number(),
    powerMoraleBase: z.number(),
    powerMoraleScale: z.number(),
    terrain: z.record(Terrain, z.number().positive()),
  }),
  economy: z.object({
    extortionRates: z.record(ExtortionRate, extortionTuning),
    contestedRouteThroughputPenalty: pct,
    payrollPerManPerWeek: z.number().nonnegative(),
    halconCostPer10CoveragePerWeek: z.number().nonnegative(),
    ammoResupplyPerMan: z.number().nonnegative(),
    factionTributeRate: pct,
    missedPayroll: z.object({
      moraleLoss: z.number(),
      leaderOpinionLoss: z.number(),
      consecutiveWeeksForDesertion: z.number().int().positive(),
      desertionRatePerDay: pct,
    }),
  }),
  characters: z.object({
    skillMax: z.number().int().positive(),
    opinionMin: z.number(),
    opinionMax: z.number(),
    heirSuccessionOpinionLoss: z.number(),
    extraditionDays: z.number().positive(),
  }),
  diplomacy: z.object({
    neutralOpinionLossPerDay: z.number(),
    neutralOpinionFloor: z.number(),
    ultimatumDays: z.array(z.number().int().nonnegative()),
    traitorOpinion: z.number(),
    sideSwitchNewFactionOpinion: z.number(),
    truceExhaustionThreshold: meter,
    truceSustainDays: z.number().int().positive(),
    foreignRouteCutMin: pct,
    foreignRouteCutMax: pct,
  }),
  state: z.object({
    startingCalentura: meter,
    calenturaDecayPerQuietDay: z.number(),
    tiers: z.object({ elevated: meter, surge: meter, occupation: meter }),
    occupationSignatureMultiplier: z.number().positive(),
    commanderBribeDays: z.number().positive(),
    commanderRotationDays: z.number().positive(),
    fightStateCalentura: z.number(),
    captureOpProfileThreshold: meter,
    captureOpIntelThreshold: meter,
  }),
  events: z.object({
    targetPlayerEventsPerWeekMin: z.number().nonnegative(),
    targetPlayerEventsPerWeekMax: z.number().nonnegative(),
  }),
  endings: z.object({
    factionCollapseSuccessionDays: z.number().positive(),
    territorialDefeatShare: pct,
    territorialDefeatDays: z.number().positive(),
    scoreWeights: z.object({
      territory: pct,
      wealth: pct,
      standing: pct,
      reputation: pct,
      force: pct,
    }),
    fateMultipliers: z.object({ free: z.number(), jailed: z.number(), deadOrExtradited: z.number() }),
  }),
  ai: z.object({
    strategicIntervalHours: z.number().int().positive(),
    operationalIntervalHours: z.number().int().positive(),
  }),
});

// ---------------------------------------------------------------------------
// Inferred content types
// ---------------------------------------------------------------------------

export type Region = z.infer<typeof RegionSchema>;
export type MapNode = z.infer<typeof MapNodeSchema>;
export type Road = z.infer<typeof RoadSchema>;
export type Colonia = z.infer<typeof ColoniaSchema>;
export type Street = z.infer<typeof StreetSchema>;
export type Faction = z.infer<typeof FactionSchema>;
export type Trait = z.infer<typeof TraitSchema>;
export type StartingCrew = z.infer<typeof StartingCrewSchema>;
export type CharacterDef = z.infer<typeof CharacterSchema>;
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;
export type GameEvent = z.infer<typeof EventSchema>;
export type EventOption = z.infer<typeof EventOptionSchema>;
export type Tuning = z.infer<typeof TuningSchema>;
