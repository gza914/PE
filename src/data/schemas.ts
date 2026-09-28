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
/** Actions the utility AI scores; traits and goals weight them. */
export const AiAction = z.enum([
  'accept_request',
  'raid',
  'defend',
  'ambush',
  'scout',
  'commit_colonia',
  'lie_low',
  'supply_run',
  'withdraw',
  'scheme',
  'message',
  'bribe',
]);
export const SchemeType = z.enum(['flip', 'assassinate', 'frame', 'leak_location', 'buy_halcones', 'compadrazgo']);
export type SchemeType = z.infer<typeof SchemeType>;

export type NodeType = z.infer<typeof NodeType>;
export type RoadType = z.infer<typeof RoadType>;
export type Terrain = z.infer<typeof Terrain>;
export type VehicleType = z.infer<typeof VehicleType>;
export type ExtortionRate = z.infer<typeof ExtortionRate>;
export type Skill = z.infer<typeof Skill>;
export type Rank = z.infer<typeof Rank>;
export type Goal = z.infer<typeof Goal>;
export type RelationType = z.infer<typeof RelationType>;
export type AiAction = z.infer<typeof AiAction>;

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
// routes.json (trafficking)
// ---------------------------------------------------------------------------

export const RouteSchema = z.object({
  id,
  name: z.string(),
  /** Consecutive nodes joined by roads, from source to border exit. */
  nodes: z.array(id).min(2),
  dailyValue: z.number().nonnegative(),
});

export const RoutesFileSchema = z.object({ routes: z.array(RouteSchema) });

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
  /** Multipliers on AI action scores (GDD "AI": trait weight). */
  aiWeights: z.partialRecord(AiAction, z.number().nonnegative()).default({}),
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
  /** Colonia the crew is committed to, for crews starting in Culiacán. */
  colonia: id.optional(),
  men: z.number().int().min(4).max(40),
  skill: z.number().int().min(1).max(5),
  gear: z.number().int().min(1).max(5),
  vehicles,
});

export const RelationSchema = z.object({ type: RelationType, target: id });

export const CharacterSchema = z.object({
  id,
  name: z.string(),
  /** Apodo shown in the UI, e.g. "El Serrano". */
  alias: z.string().nullable().default(null),
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

/**
 * Trigger vocabulary. Each key is a condition the event system checks against
 * the event's scope (plaza, character, faction, or region). Unknown keys are
 * rejected so content cannot drift ahead of the code that reads it.
 */
export const EventConditionsSchema = z
  .object({
    is_player: z.boolean(),
    owner_is_player: z.boolean(),
    /** The deciding character is neutral / aligned with a faction. */
    decider_neutral: z.boolean(),
    decider_aligned: z.boolean(),
    has_foreign_ally: z.boolean(),
    labs_gt: z.number(),
    businesses_gt: z.number(),
    calentura_gt: z.number(),
    calentura_lt: z.number(),
    support_gt: z.number(),
    support_lt: z.number(),
    military_presence_gt: z.number(),
    combat_hours_gt: z.number(),
    exhaustion_gt: z.number(),
    supply_lt: z.number(),
    profile_gt: z.number(),
    respect_gt: z.number(),
    cash_gt: z.number(),
    cash_lt: z.number(),
    age_gt: z.number(),
    day_gt: z.number(),
    day_lt: z.number(),
    days_since_bribe_gt: z.number(),
    has_trait: id,
    /** The scope character is held by the State (jailed). */
    jailed: z.boolean(),
    rank_is: Rank,
    node_type: NodeType,
    extortion_rate_is: ExtortionRate,
    family_member_died: z.boolean(),
    losing_ground: z.boolean(),
    missed_payroll: z.boolean(),
    halcones_bought: z.boolean(),
    battle_in_populated_node: z.boolean(),
    cash_on_road: z.boolean(),
    commissioned_corrido: z.boolean(),
  })
  .partial()
  .strict();

/**
 * Effect vocabulary. Deltas apply to the event's scope and, for money and
 * reputation, to the character taking the decision.
 */
export const EventEffectsSchema = z
  .object({
    money: z.number(),
    calentura: z.number(),
    support: z.number(),
    fear: z.number(),
    respect: z.number(),
    credibility: z.number(),
    profile: z.number(),
    health: z.number(),
    state_intel: z.number(),
    halcones: z.number(),
    labs: z.number(),
    labs_move_to: z.enum(['nearest_sierra_owned']),
    businesses_pct: z.number(),
    men: z.number(),
    crew_morale: z.number(),
    supply: z.number(),
    exhaustion: z.number(),
    opinion_scope: z.number(),
    opinion_scope_allies: z.number(),
    opinion_own_faction: z.number(),
    opinion_rival_faction: z.number(),
    opinion_both_factions: z.number(),
    extortion_rate: ExtortionRate,
    /** A major faction id, or "neutral". */
    declare_alignment: id,
    schedule_event: id,
    in_hours: z.number().nonnegative(),
    delay_event: id,
    delay_days: z.number().positive(),
    start_military_clash: z.boolean(),
    truce_days: z.number().positive(),
    /** Break the decider's local truces in the scope's region. */
    end_truce: z.boolean(),
    bribe_commander_days: z.number().positive(),
    police_tips: z.boolean(),
    foreign_alliance: z.boolean(),
    add_vendetta: z.boolean(),
    set_goal: Goal,
    compadrazgo: z.boolean(),
    promote_scope: z.boolean(),
    kill_scope_character: z.boolean(),
    release_character: z.boolean(),
    plant_rumor: z.boolean(),
    lie_low_region: z.boolean(),
    gain_scope_plazas: z.boolean(),
    reveal_schemer: z.boolean(),
    /** The decider's own opinion of the other character. */
    decider_opinion_of_other: z.number(),
    calentura_statewide: z.number(),
    /** How a capture operation ends. */
    resolve_capture: z.enum(['fight', 'flee', 'surrender']),
    jail_bribe: z.boolean(),
    /** The State takes a share of the scope plaza's stash (tuning.state.raids.stashSeizedShare). */
    seize_stash: z.boolean(),
    /** The scope plaza's bought halcones work for its owner again. */
    reclaim_halcones: z.boolean(),
    jail_breakout: z.boolean(),
  })
  .partial()
  .strict()
  .refine((e) => e.in_hours === undefined || e.schedule_event !== undefined, 'in_hours needs schedule_event')
  .refine((e) => e.delay_days === undefined || e.delay_event !== undefined, 'delay_days needs delay_event');

export const EventOptionSchema = z.object({
  label: z.string(),
  conditions: EventConditionsSchema.optional(),
  effects: EventEffectsSchema.default({}),
  ai_weight: z.number().min(0).default(1),
});

export const EventSchema = z.object({
  id,
  scope: EventScope,
  /** Events in the same chain never fire back to back. */
  chain: id.optional(),
  trigger: EventConditionsSchema,
  /** Mean time to happen, in days. Omit for events only fired by other events. */
  mean_days: z.number().positive().optional(),
  /**
   * For events about the decider themselves: the second character the event
   * involves (opinion_scope and similar effects target them). Events about
   * someone else already have them as the scope.
   */
  counterpart: z.enum(['ally', 'rival_lieutenant', 'relative']).optional(),
  /**
   * For character events: who decides. "self" is the scope character; "boss"
   * is their superior (the crew's owner, or their faction head), and the scope
   * character becomes the event's other character.
   */
  decided_by: z.enum(['self', 'boss']).default('self'),
  /** Fires for only one decider per scope within the repeat cooldown (e.g. one truce offer per region). */
  once_per_scope: z.boolean().default(false),
  /** Fired by a system (the State, schemes) rather than by mean time or other events. */
  fired_by_system: z.boolean().default(false),
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
  /** Extra speed factor on brechas (motorcycles are fast off-road). */
  brechaSpeedMultiplier: z.number().positive().optional(),
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
    /** Daily combat hours at which a region shows Skirmishing / Offensive. */
    skirmishingCombatHours: z.number().nonnegative(),
    offensiveCombatHours: z.number().nonnegative(),
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
    lastSeenFadeHours: z.number().positive(),
    droneRevealHours: z.number().positive(),
    droneNoticeAlertnessFactor: z.number().nonnegative(),
    droneCost: z.number().nonnegative(),
    /** Crew stealth multiplier indexed by skill − 1. */
    stealthBySkill: z.array(z.number().positive()).length(5),
    ambushSignatureMultiplier: z.number().nonnegative(),
    /** Coverage a patrolling crew provides on its road segment. */
    patrolCoverage: meter,
    /** How often a crew sitting in a watched node rolls again. */
    stationaryRollIntervalHours: z.number().int().positive(),
    /** Road-visibility stand-in for a crew sitting in a node. */
    stationaryVisibility: z.number().nonnegative(),
    /** Coverage a network assumes for rival plazas it has no intel on. */
    assumedUnknownCoverage: meter,
    /** Halcón sightings report men within ± this fraction. */
    halconMenEstimateError: pct,
    reportRetentionHours: z.number().positive(),
    /** Crews in the same node see each other; a sighting is refiled at most this often. */
    presenceReportIntervalHours: z.number().int().positive(),
  }),
  movement: z.object({
    fatiguePerTravelHour: z.number().nonnegative(),
    fatigueRecoveryPerHour: z.number().nonnegative(),
    breakdownDelayHours: z.number().int().nonnegative(),
  }),
  routing: z.object({
    /** Route cost = hours + weight × expected detections. */
    balancedRiskWeightHours: z.number().nonnegative(),
    safestRiskWeightHours: z.number().nonnegative(),
  }),
  crews: z.object({
    minMen: z.number().int().positive(),
    maxMen: z.number().int().positive(),
    moraleBreakThreshold: meter,
    ammoHoursOfFighting: z.number().positive(),
    startingMorale: meter,
    startingAlertness: meter,
    /** Morale drifts back toward this while resting in a friendly plaza. */
    moraleBaseline: meter,
    moraleRecoveryPerHour: z.number().nonnegative(),
    /** Percent of a full load restored per hour at a friendly plaza. */
    ammoResupplyPerHour: z.number().nonnegative(),
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
    /** Terrain used for fights inside a node. */
    nodeTerrain: z.record(NodeType, Terrain),
    /** Leader Violencia above 10 adds this much power per point (below 10 subtracts). */
    violenciaBonusPerPoint: z.number().nonnegative(),
    /** Power lost at 100 fatigue. */
    fatiguePowerPenalty: pct,
    /** Men-equivalent losses each armored truck absorbs per hour. */
    armoredAbsorbPerTruck: z.number().nonnegative(),
    /** Truck damage per absorbed loss; a truck is lost at 100. */
    armoredDamagePerAbsorbed: z.number().nonnegative(),
    armorPushPowerMultiplier: z.number().positive(),
    armorPushDamageMultiplier: z.number().positive(),
    /** Morale lost per percent of the crew lost in an hour. */
    moraleLossPerPctLost: z.number().nonnegative(),
    /** Morale lost per hour of fighting regardless of losses. */
    moraleLossPerHour: z.number().nonnegative(),
    leaderLossMorale: z.number().nonnegative(),
    routCaptureShare: pct,
    routScatterShare: pct,
    /** Chance the leader falls in an hour = loss fraction × this × trait risk. */
    leaderRiskPerLossFraction: z.number().nonnegative(),
    leaderCaptureChanceOnRout: pct,
    leaderDeathChanceOnDestroyed: pct,
    /** A force attacks only with this power ratio or better (× leader caution). */
    engageRatio: z.number().positive(),
    /** Power assumed per reported man when judging an enemy from reports. */
    estimatedPowerPerMan: z.number().positive(),
    ambushSpotAlertnessFactor: pct,
    withdrawLossMultiplier: z.number().nonnegative(),
    /** Enemy average morale below which the player may accept their surrender. */
    surrenderMorale: meter,
    /** Own average morale below which the player is warned. */
    waveringMorale: meter,
    battleRetentionHours: z.number().nonnegative(),
    reinforceMaxHours: z.number().positive(),
    helpCrewsPerCall: z.number().int().nonnegative(),
    calenturaPerCombatHour: z.number().nonnegative(),
    calenturaPerCasualty: z.number().nonnegative(),
    supplyPerCombatHour: z.number().nonnegative(),
    exhaustionPerCasualty: z.number().nonnegative(),
    /** Each side's exhaustion rises this much per hour of fighting. */
    exhaustionPerCombatHour: z.number().nonnegative(),
    respectPerVictory: z.number().nonnegative(),
    skillUpEveryBattles: z.number().int().positive(),
    capturedPlazaHalcones: meter,
    capturedPlazaSupportLoss: meter,
    /** Plaza fortification at which an assault becomes a siege. */
    siegeMinFortification: z.number().int().min(0).max(3),
    siege: z.object({
      casualtyMultiplier: z.number().nonnegative(),
      ammoMultiplier: z.number().nonnegative(),
      moraleMultiplier: z.number().nonnegative(),
      progressPerHourAtParity: z.number().nonnegative(),
      defenderResupplyPerHour: z.number().nonnegative(),
      fortificationLossOnFall: z.number().int().nonnegative(),
    }),
    urban: z.object({
      casualtyMultiplier: z.number().nonnegative(),
      ammoMultiplier: z.number().nonnegative(),
      moraleMultiplier: z.number().nonnegative(),
      /** Control shift per hour at total superiority. */
      controlShiftPerHour: z.number().nonnegative(),
      uncontestedShiftPerHour: z.number().nonnegative(),
    }),
  }),
  economy: z.object({
    extortionRates: z.record(ExtortionRate, extortionTuning),
    contestedRouteThroughputPenalty: pct,
    payrollPerManPerWeek: z.number().nonnegative(),
    halconCostPer10CoveragePerWeek: z.number().nonnegative(),
    ammoResupplyPerMan: z.number().nonnegative(),
    factionTributeRate: pct,
    /** Extortion compliance = base + support × perSupport + owner fear × perFear − military × perMilitaryPresence. */
    compliance: z.object({
      base: z.number(),
      perSupport: z.number(),
      perFear: z.number(),
      perMilitaryPresence: z.number(),
      min: pct,
      max: pct,
    }),
    racketPerBusinessPerDay: z.number().nonnegative(),
    labOutputPerDay: z.number().nonnegative(),
    /** Dollars of faction income per +1 faction Supply. */
    supplyPerIncome: z.number().positive(),
    businessLossPerCombatHour: pct,
    supportLossPerCombatHour: z.number().nonnegative(),
    /** Share of a plaza's original businesses that reopen per quiet week. */
    businessRecoveryPerWeek: pct,
    recruitment: z.object({
      signingCostPerMan: z.number().nonnegative(),
      recruitSkill: z.number().int().min(1).max(5),
      recruitGear: z.number().int().min(1).max(5),
      poolPerDayByType: z.record(NodeType, z.number().nonnegative()),
      poolPerBusinessPerDay: z.number().nonnegative(),
      /** The recruit pool holds at most this many days of growth. */
      poolCapDays: z.number().positive(),
    }),
    armoredStartStock: z.number().int().nonnegative(),
    armoredRestockDays: z.number().positive(),
    aid: z.object({
      cooldownDays: z.number().nonnegative(),
      maxCash: z.number().nonnegative(),
      headCashShare: pct,
    }),
    /** Days of income and costs kept for the economy ledger. */
    ledgerDays: z.number().int().positive(),
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
    /** Placeholder until prisoner events: captives are ransomed after this long. */
    prisonerHoldDays: z.number().positive(),
    ransomAmount: z.number().nonnegative(),
    /** Permanent opinion from a relationship, by type. */
    relationOpinion: z.record(RelationType, z.number()),
    /** Opinion bonus between members of the same faction. */
    sharedFactionOpinion: z.number(),
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
    /** Crew an outside cartel sends its new partner. */
    foreignCrew: z.object({ men: z.number().int().positive(), skill: z.number().int().min(1).max(5), gear: z.number().int().min(1).max(5), pickups: z.number().int().nonnegative() }),
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
    /** Off in mechanics tests: no checkpoints, raids, or capture operations. */
    enabled: z.boolean(),
    /** Extra calentura spread to every region when state forces are attacked. */
    statewideSurgeCalentura: z.number().nonnegative(),
    checkpoints: z.object({
      /** Chance a group is stopped when it takes a road, by the region's tier and road type. */
      chance: z.record(z.enum(['normal', 'elevated', 'surge', 'occupation']), z.record(RoadType, pct)),
      delayHours: z.number().int().nonnegative(),
      feePerVehicle: z.number().nonnegative(),
      /** Checkpoint chance for a network that bribed the region's commander. */
      bribedMultiplier: pct,
      stateIntelPerStop: z.number().nonnegative(),
    }),
    raids: z.object({
      /** Daily chance the army raids a plaza with labs or a big stash, by tier. */
      dailyChance: z.object({ surge: pct, occupation: pct }),
      bribedMultiplier: pct,
      /** A stash smaller than this is not worth raiding. */
      stashMin: z.number().nonnegative(),
      /** Hours between the decision to raid and the raid itself. */
      leadHours: z.number().int().positive(),
      /** Share of a raided stash that is seized (the event's options set the rest). */
      stashSeizedShare: pct,
    }),
    commanderBribeCost: z.number().nonnegative(),
    police: z.object({ cost: z.number().nonnegative(), days: z.number().positive(), halconBonus: z.number().nonnegative() }),
    tipOff: z.object({
      cost: z.number().nonnegative(),
      stateIntel: z.number().nonnegative(),
      traceBaseChance: pct,
      tracePerAstucia: pct,
      traceOpinion: z.number(),
    }),
    scapegoat: z.object({ calenturaDrop: z.number().nonnegative(), men: z.number().int().positive(), opinion: z.number(), cooldownDays: z.number().nonnegative() }),
    lieLow: z.object({ days: z.number().positive(), extraDecayPerDay: z.number().nonnegative(), incomeMultiplier: pct }),
    captureOps: z.object({
      /** State intel per day for each profile point above the threshold, scaled up by calentura. */
      intelPerProfilePoint: z.number().nonnegative(),
      /** Daily decay of state intel while the character stays under the profile threshold. */
      decayPerDay: z.number().nonnegative(),
      /** Each crew guarding the character's home plaza slows the meter by this share. */
      escortSlowdown: pct,
      /** Intel left after a successful escape. */
      intelAfterEscape: meter,
      fleeCashLossShare: pct,
      fightEscapeChance: pct,
      jailBribeCost: z.number().nonnegative(),
      jailBribeChance: pct,
      breakoutChance: pct,
    }),
    militaryClash: z.object({
      lossShareMin: pct,
      lossShareMax: pct,
      calentura: z.number().nonnegative(),
      /** Chance a leader present is captured by the army. */
      leaderCaptureChance: pct,
    }),
  }),
  events: z.object({
    targetPlayerEventsPerWeekMin: z.number().nonnegative(),
    targetPlayerEventsPerWeekMax: z.number().nonnegative(),
    /** Off in mechanics tests. */
    enabled: z.boolean(),
    /** Scales every event's mean_days (below 1, events come more often). */
    meanDaysMultiplier: z.number().positive(),
    /** Mean-time-to-happen events stop firing for the player past this many in the last 7 days. */
    playerWeeklyCap: z.number().int().nonnegative(),
    /** The same event does not fire again for the same scope and decider within this. */
    repeatCooldownDays: z.number().nonnegative(),
    /** Two events of one chain never fire for the same decider within this (scheduled follow-ups excepted). */
    chainCooldownDays: z.number().nonnegative(),
    /** Unanswered player events resolve with the advisor's pick after this long. */
    autoResolveHours: z.number().int().positive(),
    familyDeathWindowDays: z.number().nonnegative(),
    /** "Losing ground": holding less than this share of one's starting territory. */
    losingGroundShare: pct,
    cashOnRoadHours: z.number().nonnegative(),
    populatedBattleDays: z.number().nonnegative(),
    /** Rolling combat-hours meters keep this share each day. */
    combatWeekKeep: pct,
    eventLogDays: z.number().int().positive(),
    /** Opinion modifiers from event choices fade over this many days. */
    opinionDecayDays: z.number().positive(),
  }),
  infowar: z.object({
    /** Message effects scale by (base + credibility/100). */
    credibilityBase: z.number().nonnegative(),
    narcomanta: z.object({ cost: z.number().nonnegative(), fear: z.number(), rivalOpinion: z.number(), calentura: z.number(), support: z.number() }),
    video: z.object({ cost: z.number().nonnegative(), morale: z.number(), profile: z.number(), respect: z.number(), calentura: z.number(), statewideCalentura: z.number(), cooldownDays: z.number().nonnegative() }),
    claim: z.object({
      morale: z.number(),
      /** A victory claim is true if the claimant's side won a battle this recently. */
      trueWindowDays: z.number().nonnegative(),
      exposureDays: z.number().positive(),
      exposureBaseChance: pct,
      exposurePerAstucia: pct,
      credibilityLoss: z.number(),
      cooldownDays: z.number().nonnegative(),
    }),
    corrido: z.object({ cost: z.number().nonnegative(), days: z.number().positive(), respectPerDay: z.number(), recruitsPerDay: z.number(), profile: z.number(), stateIntel: z.number() }),
    rumor: z.object({
      cost: z.number().nonnegative(),
      /** A planted sighting stays believable this long. */
      lastsHours: z.number().positive(),
      discoveryBaseChance: pct,
      discoveryPerAstucia: pct,
      credibilityLoss: z.number(),
      targetOpinion: z.number(),
      betrayalOpinion: z.number(),
      /** A Paranoico head purges a lieutenant they think this little of. */
      purgeBelowOpinion: z.number(),
      fakeConvoyMen: z.number().int().positive(),
      fakeGarrisonMen: z.number().int().positive(),
    }),
    showOfForce: z.object({ fear: z.number(), respect: z.number(), recruits: z.number(), calentura: z.number(), support: z.number() }),
  }),
  schemes: z.object({
    enabled: z.boolean(),
    maxActive: z.number().int().positive(),
    /** Opinion the target takes of a discovered schemer. */
    discoveredOpinion: z.number(),
    types: z.record(
      SchemeType,
      z.object({
        cost: z.number().nonnegative(),
        skill: Skill,
        /** Daily progress = base + skill × perSkill (out of 100). */
        base: z.number(),
        perSkill: z.number(),
        /** Daily discovery = base + target Astucia × perAstucia (Paranoico targets double it). */
        discoveryBase: pct,
        discoveryPerAstucia: pct,
        /** Success when progress completes: base + skill × perSkill, then per-type adjustments. */
        successBase: z.number(),
        successPerSkill: z.number(),
      }),
    ),
    flipOpinionWeight: z.number(),
    assassinateSecurityPerCrew: z.number(),
    assassinateParanoicoPenalty: z.number(),
    frameOpinion: z.number(),
    frameStateIntel: z.number(),
    leakStateIntel: z.number(),
    compadrazgoOpinion: z.number(),
    /** AI owners notice bought halcones (daily base + Astucia × perAstucia) and buy them back. */
    halconNotice: z.object({ base: pct, perAstucia: pct, buyBackCost: z.number().nonnegative() }),
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
    /** Daily chance a headless faction finds a successor before it collapses. */
    successionChancePerDay: pct,
    /** An AI head refuses a truce while its faction holds more than this share. */
    truceAcceptMaxShare: pct,
    /** At the time cap, a faction with at least this share is the winner. */
    timeCapWinnerMinShare: pct,
    kingmakerDeclareAfterDays: z.number().nonnegative(),
    patronMinScore: z.number(),
    corridoMinRespect: z.number(),
    /** Each score category's end/start ratio is capped here. */
    scoreRatioCap: z.number().positive(),
  }),
  ai: z.object({
    strategicIntervalHours: z.number().int().positive(),
    operationalIntervalHours: z.number().int().positive(),
    /** Scripted logistics traffic until the utility AI lands. */
    trafficChancePerCheck: pct,
    returnHomeChancePerCheck: pct,
    trafficMaxTripHours: z.number().positive(),
    /** Only crews this small run supplies; big crews stay put. */
    trafficMaxMen: z.number().int().positive(),
    /**
     * Late-war escalation: from startDay, an AI's army target scales with its
     * territory against the start, within these bounds (money becomes men).
     */
    forceGrowth: z.object({ startDay: z.number().nonnegative(), min: z.number().positive(), max: z.number().positive() }),
    /** The AI's dealings with the State, messages, and schemes (the "shadow" layer), once a day per character. */
    shadow: z.object({
      /** Weeks of bills kept in reserve before spending on any of this. */
      reserveWeeks: z.number().nonnegative(),
      /** Region tier (0 normal … 3 occupation) at which a character bribes the commander where it has labs or cash. */
      bribeCommanderTier: z.number().int().min(0).max(3),
      /** Region tier at which a cautious character lies low. */
      lieLowTier: z.number().int().min(0).max(3),
      /** Minimum caution × lie_low weight to lie low. */
      lieLowMinWeight: z.number().nonnegative(),
      /** Region tier at which a character hands over a scapegoat. */
      scapegoatTier: z.number().int().min(0).max(3),
      /** Daily chance, before trait and goal weights, to start a scheme / send a message / plant a rumor. */
      schemeDailyChance: pct,
      messageDailyChance: pct,
      rumorDailyChance: pct,
      /** A corrido is commissioned only with this many times its cost in hand. */
      corridoCashMultiple: z.number().positive(),
      /** Days after taking a plaza that a banner claims it. */
      claimBannerDays: z.number().nonnegative(),
      /** A head posts a rally video when his crews' average morale falls below this. */
      rallyMoraleBelow: meter,
      claimBannerChance: pct,
      rallyDailyChance: pct,
      /** How a scheme against a neighbor is chosen: flip, else buy halcones, else strike (frame, or assassinate if Sanguinario). */
      schemeMix: z.object({ flip: pct, buyHalcones: pct }),
    }),
    /** Weeks of bills an AI keeps in reserve before spending on recruits. */
    economyReserveWeeks: z.number().nonnegative(),
    /** Switch AI layers off (tests, debugging). */
    layers: z.object({
      strategic: z.boolean(),
      operational: z.boolean(),
      tactical: z.boolean(),
      economy: z.boolean(),
      traffic: z.boolean(),
      /** AI answers to events. */
      events: z.boolean(),
      /** AI dealings with the State, messages, and schemes. */
      shadow: z.boolean(),
    }),
    /** Multipliers on AI action scores by goal (GDD "AI": goal weight). */
    goalWeights: z.record(Goal, z.partialRecord(AiAction, z.number().nonnegative())),
    /** Faction heads: war plans and offensives. */
    strategic: z.object({
      hourOfDay: z.number().int().min(0).max(23),
      /** No faction offensive before this day, so the player can get their bearings. */
      firstOffensiveDay: z.number().nonnegative(),
      offensiveMinSupply: meter,
      /** Power an offensive gathers, as a multiple of the target's estimated defense. */
      attackForceRatio: z.number().positive(),
      /** Late in a long war heads grow impatient: the ratio eases to this... */
      lateAttackForceRatio: z.number().positive(),
      /** ...linearly between these days. */
      lateWarStartDay: z.number().nonnegative(),
      lateWarFullDay: z.number().nonnegative(),
      /** A faction below this share of the map fights with the late-war margin (as do retakes and attacks on neutrals). */
      desperateShare: z.number().min(0).max(1),
      maxParticipantHours: z.number().positive(),
      /** Hours lieutenants get to answer before the planned arrival time. */
      responseHours: z.number().nonnegative(),
      slackHours: z.number().nonnegative(),
      offensiveCooldownHours: z.number().nonnegative(),
      /** An offensive with no fighting this long after its arrival time is called off. */
      offensiveTimeoutHours: z.number().positive(),
      /** Dollars of daily plaza value per point of target score. */
      valuePerScorePoint: z.number().positive(),
      hourPenalty: z.number().nonnegative(),
      riskPenalty: z.number().nonnegative(),
      focusBonus: z.number().nonnegative(),
      /** From this day, neutral plazas are fair game for offensives (neutrality turns dangerous). */
      neutralTargetDay: z.number().nonnegative(),
      neutralTargetBonus: z.number(),
      /** How much a head's caution raises the force it gathers: ratio × (1 + (caution − 1) × this). */
      cautionForceWeight: z.number().nonnegative(),
      /** Bonus for retaking a plaza the faction lost recently. */
      retakeBonus: z.number().nonnegative(),
      retakeWindowDays: z.number().nonnegative(),
      /** A threat this small next to the faction's free strength doesn't stop an attack. */
      minorThreatShare: pct,
      routeCutBonus: z.number().nonnegative(),
      /** Garrison assumed at rival plazas with no fresh intel. */
      priorGarrisonMenByType: z.record(NodeType, z.number().nonnegative()),
      intelStaleHours: z.number().positive(),
      threatHops: z.number().int().nonnegative(),
      threatRecentHours: z.number().positive(),
      /** A plaza is threatened when nearby enemy strength exceeds its garrison × this. */
      defendRatio: z.number().positive(),
      maxDefendRequests: z.number().int().nonnegative(),
      /** Crews a faction tries to keep committed in Culiacán's contested colonias. */
      coloniaCrewsTarget: z.number().int().nonnegative(),
      /** A head with less than this many weeks of bills asks rich lieutenants for a levy. */
      levyCashWeeks: z.number().nonnegative(),
      levyShare: pct,
      levyRichWeeks: z.number().nonnegative(),
    }),
    /** Lieutenants: requests and their own initiative. */
    operational: z.object({
      /** An initiative runs only if its score reaches this. */
      actThreshold: z.number(),
      /** No private raids, ambushes, or scouting before this day. */
      firstInitiativeDay: z.number().nonnegative(),
      raidMinRatio: z.number().positive(),
      raidMaxHours: z.number().positive(),
      raidValuePerPoint: z.number().positive(),
      raidRiskPenalty: z.number().nonnegative(),
      relationTargetBonus: z.number().positive(),
      focusRegionBonus: z.number().positive(),
      ambushRecentHours: z.number().positive(),
      ambushTrafficValue: z.number().nonnegative(),
      ambushMaxHours: z.number().positive(),
      scoutStaleHours: z.number().positive(),
      scoutValue: z.number().nonnegative(),
      scoutMaxMen: z.number().int().positive(),
      scoutHoldHours: z.number().positive(),
      colonia: z.object({ value: z.number().nonnegative(), maxCrews: z.number().int().nonnegative() }),
      neutralDeclareMinLean: z.number(),
      neutralDeclareChancePerCheck: pct,
    }),
    /** Crew leaders in battle. */
    tactical: z.object({
      withdrawRatio: z.number().nonnegative(),
      /** However cautious the leader, never withdraw at better odds than this. */
      maxWithdrawRatio: z.number().nonnegative(),
      /** Do not withdraw while friendly crews will arrive within this many hours. */
      reinforcementWindowHours: z.number().nonnegative(),
      fortifiedHoldRatio: z.number().nonnegative(),
      armorPushMinRatio: z.number().nonnegative(),
      armorPushMaxRatio: z.number().nonnegative(),
    }),
    /** Faction requests and the opinion they move. */
    requests: z.object({
      acceptBase: z.number(),
      opinionWeight: z.number(),
      playerResponseHours: z.number().positive(),
      fulfilledOpinion: z.number(),
      declinedOpinion: z.number(),
      failedOpinion: z.number(),
      ignoredOpinion: z.number(),
      rewardOpinion: z.number(),
      opinionDecayDays: z.number().positive(),
      keepHours: z.number().nonnegative(),
      /** After a refused or ignored request, the head waits this long before asking that person again. */
      repeatCooldownHours: z.number().nonnegative(),
    }),
  }),
});

// ---------------------------------------------------------------------------
// Inferred content types
// ---------------------------------------------------------------------------

export type Region = z.infer<typeof RegionSchema>;
export type MapNode = z.infer<typeof MapNodeSchema>;
export type Road = z.infer<typeof RoadSchema>;
export type TradeRoute = z.infer<typeof RouteSchema>;
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
