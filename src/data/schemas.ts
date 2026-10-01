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
    reportRetentionHours: z.number().positive(),
    /** Crews in the same node see each other; a sighting is refiled at most this often. */
    presenceReportIntervalHours: z.number().int().positive(),
  }),
  /** GDD "Intelligence as estimates": sightings are ranges that narrow and age. */
  intel: z.object({
    /** Half-width of the range a source supports, as a fraction of its estimate. */
    spread: z.object({ halcon: pct, patrol: pct, drone: pct, presence: pct, rumor: pct, informant: pct }),
    /** The estimate itself is off by up to this share of the spread. */
    errorShareOfSpread: pct,
    /** Ranges widen by this fraction per hour of age, up to maxWiden times. */
    widenPerHour: z.number().nonnegative(),
    maxWiden: z.number().min(1),
    droneTown: z.object({
      cost: z.number().nonnegative(),
      hours: z.number().positive(),
      /** Share of men in the street a drone can count. */
      streetMin: pct,
      streetMax: pct,
      /** Crews lying low stay indoors: their street share is multiplied by this. */
      lyingLowFactor: pct,
      noticeAlertnessFactor: z.number().nonnegative(),
    }),
    informant: z.object({
      cost: z.number().nonnegative(),
      settleDays: z.number().nonnegative(),
      reportEveryHours: z.number().int().positive(),
      qualityMin: pct,
      qualityMax: pct,
      qualityPerAstucia: z.number().nonnegative(),
      /** Share of a garrison one report samples, at quality 0 and 1. */
      sampleAtWorst: pct,
      sampleAtBest: pct,
      /** Range half-width at quality 0 and 1. */
      spreadAtWorst: pct,
      spreadAtBest: pct,
      maxPerNetwork: z.number().int().positive(),
      discovery: z.object({
        base: pct,
        /** Per point of the plaza holder's halcón coverage. */
        perCoverage: z.number().nonnegative(),
        /** Per point of the plaza owner's astucia. */
        perAstucia: z.number().nonnegative(),
        /** Taken off per point of quality. */
        qualityProtect: z.number().nonnegative(),
        max: pct,
      }),
      caughtOpinion: z.number(),
      caughtOpinionDecayDays: z.number().positive(),
      /** Places a sample is taken, for the report text. */
      spots: z.array(z.string()).min(1),
    }),
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
  /** GDD "Battles": stances chosen every few hours, and one-off actions. */
  battle: z.object({
    decisionEveryHours: z.number().int().positive(),
    stances: z.record(z.enum(['assault', 'hold', 'flank', 'probe']), z.object({ dealt: z.number().nonnegative(), taken: z.number().nonnegative() })),
    flank: z.object({
      minCrews: z.number().int().min(1),
      baseChance: pct,
      perSkill: z.number().nonnegative(),
      perAstucia: z.number().nonnegative(),
      successDealt: z.number().nonnegative(),
      failTaken: z.number().nonnegative(),
      /** Terrain (combat.terrain keys) where flanking cannot work. */
      badTerrain: z.array(z.string()),
    }),
    digIn: z.object({ dealt: z.number().nonnegative(), maxFortification: z.number().int().min(0) }),
    droneRevealHours: z.number().nonnegative(),
    /** The other side takes terms to leave when it is this weak relative to you, or its morale this low. */
    terms: z.object({ acceptRatio: z.number().positive(), acceptMorale: z.number().min(0).max(100) }),
    executePrisoners: z.object({ fear: z.number().nonnegative(), calentura: z.number().nonnegative(), supportLoss: z.number().nonnegative(), windowHours: z.number().nonnegative() }),
    ai: z.object({ assaultRatio: z.number().positive(), holdRatio: z.number().positive(), flankChance: pct }),
  }),
  /** GDD "Capturing bosses". */
  capture: z.object({
    rankBase: z.record(Rank, pct),
    /** Force ratio (winners / losers) is divided by this, then clamped. */
    ratioDivisor: z.number().positive(),
    ratioMin: z.number().nonnegative(),
    ratioMax: z.number().positive(),
    encircledMultiplier: z.number().positive(),
    traitMultiplier: z.record(z.string(), z.number().positive()),
    /** By node type, or "road". */
    terrainMultiplier: z.record(z.string(), z.number().positive()),
    situation: z.object({ destroyed: z.number().nonnegative(), routed: z.number().nonnegative(), fellBack: z.number().nonnegative(), withdrew: z.number().nonnegative() }),
    max: pct,
    aiDecideHours: z.number().nonnegative(),
    /** A captive nobody decides about is bought out by his side after this long. */
    maxHoldDays: z.number().positive(),
    ransomByRank: z.record(Rank, z.number().nonnegative()),
    ransomGrudge: z.number(),
    interrogate: z.object({ healthLoss: z.number().nonnegative(), familyOpinion: z.number(), maxSessions: z.number().int().positive() }),
    turn: z.object({ base: pct, perPalabra: z.number().nonnegative(), resentBonus: pct, resentBelow: z.number(), failOpinion: z.number() }),
    leverageDays: z.number().positive(),
    handOver: z.object({ calenturaDrop: z.number().nonnegative(), respectLoss: z.number().nonnegative(), stateIntelDrop: z.number().nonnegative() }),
    execute: z.object({ fear: z.number().nonnegative(), calentura: z.number().nonnegative() }),
    release: z.object({ opinion: z.number() }),
  }),
  /** GDD "A boss who has lost everything". */
  lostEverything: z.object({
    /** Share of his cash a boss going to ground keeps for the fight. */
    campShareOfCash: pct,
    serveRankDrop: z.number().int().nonnegative(),
    /** Mercenaries a boss going neutral hires, if he can. */
    neutralMercMen: z.number().int().nonnegative(),
  }),
  /** GDD "The countryside around each plaza". */
  countryside: z.object({
    /** Zone size by node type: bigger zones need more men to sway. */
    sizeByType: z.record(z.string(), z.number().positive()),
    startHolderInfluence: z.number().min(0).max(100),
    campGainPerManPerDay: z.number().nonnegative(),
    /** The town's holder gains this a day at full support. */
    holderGainPerDay: z.number().nonnegative(),
    garrisonGainPerManPerDay: z.number().nonnegative(),
    decayPerDay: z.number().nonnegative(),
    /** Countryside counts for this share of a plaza's value in the map share. */
    shareWeight: z.number().nonnegative(),
    /** Signature multiplier for camped crews, by node type. */
    campVisibility: z.record(z.string(), z.number().nonnegative()),
    /** Campers fight sweeps with the terrain on their side. */
    campDefenseMultiplier: z.number().positive(),
    sweepCooldownHours: z.number().nonnegative(),
    /** Step two: people in the hills watch the roads; coverage per point of influence, from this much up. */
    lookoutCoveragePerInfluence: z.number().nonnegative(),
    lookoutMinInfluence: z.number().min(0).max(100),
    /** Route income through a plaza falls by this times the rivals' share of its hills. */
    contestedRouteCut: pct,
    /** Rural economy a zone pays a day, per unit of zone size, split by influence. */
    ruralIncomePerDayPerSize: z.number().nonnegative(),
    /** Plaza types whose labs sit out of town: their output follows the holder's hold on the hills. */
    labsOutsideTypes: z.array(z.string()),
    labFloor: pct,
    /** Army lab raids are this much less likely at full influence in the hills. */
    labProtection: pct,
    roadTintMinInfluence: z.number().min(0).max(100),
    ai: z.object({
      /** Campers strike when they believe they beat the garrison by this ratio. */
      opportunismRatio: z.number().positive(),
      /** Holders sweep when a rival's influence in their hills passes this. */
      sweepInfluence: z.number().min(0).max(100),
      sweepChancePerCheck: pct,
      /** After losing a plaza whose hills its side still holds, a spare crew nearby camps there. */
      remnantWithinDays: z.number().nonnegative(),
      remnantMinInfluence: z.number().min(0).max(100),
      remnantChancePerCheck: pct,
      remnantMaxHops: z.number().int().nonnegative(),
      remnantMinMen: z.number().int().positive(),
    }),
  }),
  /** GDD "Outside cartels: CJNG and CdG". */
  outside: z.object({
    cartels: z.record(
      z.string(),
      z.object({
        tiers: z.record(z.enum(['carne', 'sicarios', 'elite']), z.object({ skill: z.number().int().min(1).max(5), gear: z.number().int().min(1).max(5), pricePerMan: z.number().nonnegative(), weeklyPerMan: z.number().nonnegative(), maxMen: z.number().int().positive() })),
        /** How much they value a plaza, cash, and a share of income. */
        plazaValueMultiplier: z.number().nonnegative(),
        cashValueMultiplier: z.number().nonnegative(),
        routeValueMultiplier: z.number().nonnegative(),
        startAmbition: z.number().min(0).max(100),
        /** Multiplies how fast ambition grows. */
        ambitionGrowth: z.number().nonnegative(),
        recallChancePerWeek: pct,
        envoyChancePerWeek: pct,
        weaponsCostMultiplier: z.number().positive(),
        armoredCost: z.number().nonnegative(),
        armoredMax: z.number().int().nonnegative(),
        loanMax: z.number().nonnegative(),
      }),
    ),
    /** Holding a plaza of these types (or next to a border exit) gives contact. */
    contactNodeTypes: z.array(z.string()),
    envoyContactDays: z.number().positive(),
    /** Neutrals pay this share of the price: they are more attractive partners. */
    neutralDiscount: z.number().positive(),
    /** Price falls this fraction per point of their attitude toward you. */
    attitudePriceEffect: z.number().nonnegative(),
    maxRounds: z.number().int().positive(),
    walkAwayDays: z.number().nonnegative(),
    /** In a counter they come down this share of the gap between their price and your offer. */
    counterMeetShare: pct,
    retainerWeeksValued: z.number().nonnegative(),
    incomeShareWeeksValued: z.number().nonnegative(),
    plazaDaysValued: z.number().nonnegative(),
    plazaLaterDiscount: pct,
    promiseDueDays: z.number().positive(),
    plazaGarrison: z.object({ men: z.number().int().positive(), skill: z.number().int().min(1).max(5), gear: z.number().int().min(1).max(5) }),
    loyalty: z.object({
      start: z.number().min(0).max(100),
      weeklyPaid: z.number(),
      weeklyMissed: z.number(),
      perWin: z.number(),
      /** Times the share of the contingent lost in a battle. */
      perLossShare: z.number(),
      desertBelow: z.number(),
      desertShareDaily: pct,
      defectAbove: z.number(),
      defectChancePerWeek: pct,
      /** Their cartel's attitude toward you after you take its men. */
      defectHostility: z.number(),
    }),
    recallWarningHours: z.number().nonnegative(),
    loan: z.object({ interest: z.number().nonnegative(), weeks: z.number().positive(), defaultAttitude: z.number(), defaultAmbition: z.number() }),
    attitude: z.object({ paidDeal: z.number(), brokenPromise: z.number(), keptPromise: z.number(), refusedDefection: z.number(), hostileBelow: z.number() }),
    ambition: z.object({
      declareAt: z.number().positive(),
      /** Ambition grows while their partner coalition holds less than this share. */
      partnerWeakShare: pct,
      perDayWeak: z.number().nonnegative(),
      perDayStrongPlaza: z.number().nonnegative(),
      decayPerDay: z.number().nonnegative(),
    }),
    hostile: z.object({ raidChancePerWeek: pct, raidMen: z.number().int().positive() }),
    ai: z.object({
      /** A head hires when its side's strength is below this ratio of the enemy's. */
      hireWhenRatioBelow: z.number().positive(),
      dailyChance: pct,
      reserveWeeks: z.number().nonnegative(),
      tier: z.enum(['carne', 'sicarios', 'elite']),
      men: z.number().int().positive(),
      cashShareOfPrice: z.number().nonnegative(),
    }),
  }),
  /** GDD "Recruitment" and "Formations". */
  forces: z.object({
    /** Names the player sees for skill 1–5 and gear 1–5. */
    skillNames: z.array(z.string()).length(5),
    gearNames: z.array(z.string()).length(5),
    /** Weekly pay multiplier by skill 1–5. */
    payBySkill: z.array(z.number().positive()).length(5),
    column: z.object({ maxCrews: z.number().int().min(1), maxMen: z.number().int().positive() }),
    weapons: z.object({
      /** Cost to arm one man at gear 1–5; upgrading pays the difference. */
      costPerManByGear: z.array(z.number().nonnegative()).length(5),
    }),
    training: z.object({
      costPerManPerDay: z.number().nonnegative(),
      sierraCostMultiplier: z.number().positive(),
      sierraRegions: z.array(z.string()),
      /** Days to go from skill n to n+1, for n = 1..4. */
      daysPerLevel: z.array(z.number().positive()).length(4),
      maxSkill: z.number().int().min(1).max(5),
      calenturaPerDay: z.number().nonnegative(),
      /** Daily chance each rival side hears about a camp. */
      discoveryChancePerDay: pct,
    }),
    veterans: z.object({
      costPerMan: z.number().nonnegative(),
      skill: z.number().int().min(1).max(5),
      gear: z.number().int().min(1).max(5),
      /** Statewide: how many come on the market each week, and the most there can be. */
      perWeek: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
    }),
    mercenaries: z.object({
      costPerMan: z.number().nonnegative(),
      skill: z.number().int().min(1).max(5),
      gear: z.number().int().min(1).max(5),
      payMultiplier: z.number().positive(),
      minMen: z.number().int().positive(),
      maxMen: z.number().int().positive(),
    }),
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
    /** Spoils by contribution: a man lost counts this many times a man who fought. */
    contributionLossWeight: z.number().nonnegative(),
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
    /** Leaving a coalition is politics: the old head's grudge fades over this many days. */
    traitorDecayDays: z.number().positive(),
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
    /** A commander about to rotate out (fewer days left than this) will not take a bribe. */
    commanderMinDaysLeft: z.number().nonnegative(),
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
  /** Coalition warfare: joint operations between bosses, and pacts. */
  coalition: z.object({
    maxInvites: z.number().int().positive(),
    /** A strike can be set this many hours ahead, at least and at most. */
    minLeadHours: z.number().int().nonnegative(),
    maxLeadHours: z.number().int().positive(),
    /** Invitees need crews that can reach the target within this many hours. */
    inviteMaxTravelHours: z.number().positive(),
    /** AI invitees answer after this many hours. */
    aiAnswerDelayHours: z.number().int().nonnegative(),
    /** The player answers by this many hours after the proposal (and before the strike). */
    playerResponseHours: z.number().int().positive(),
    /** An attack is judged this many hours after the strike time (sooner if the plaza falls). */
    resolveWindowHours: z.number().int().positive(),
    /** Fighting at the target this many hours before the strike still counts for the operation. */
    earlyHours: z.number().int().nonnegative(),
    /** Opinion of someone who agreed and did not show up. */
    noShowOpinion: z.number(),
    noShowDecayDays: z.number().positive(),
    leak: z.object({ base: pct, perParticipant: pct, perAstucia: pct }),
    ai: z.object({
      /** Committed power against the target's estimated defense needed before a boss joins. */
      minRatio: z.number().positive(),
      valuePerPoint: z.number().positive(),
      cashPerPoint: z.number().positive(),
      opinionWeight: z.number(),
      riskPenalty: z.number().nonnegative(),
      threshold: z.number(),
      maxCounterCash: z.number().nonnegative(),
      /** Base value of helping hold an ally's plaza. */
      defendBase: z.number(),
      /** Daily chance, before weights, that an AI lieutenant proposes an attack or asks for help defending. */
      proposeDailyChance: pct,
      defendProposeDailyChance: pct,
      /** A joiner stops adding crews once committed power reaches the need times this. */
      commitOvershoot: z.number().positive(),
      /** Crews sent to hold an ally's plaza. */
      defendCrews: z.number().int().positive(),
      defendLeadHours: z.number().int().positive(),
      defendHoldHours: z.number().int().positive(),
      /** Extra hours on top of the slowest crew when an AI sets a strike time. */
      slackHours: z.number().int().nonnegative(),
      /** An AI proposer gives up the plaza to a counter-offer only if it wants plazas less than this (raid weight). */
      plazaCounterMaxRaidWeight: z.number().positive(),
      /** An AI proposer pays a cash counter only up to this share of its cash. */
      counterMaxCashShare: pct,
    }),
    pacts: z.object({
      offerHours: z.number().int().positive(),
      defaultDays: z.number().nonnegative(),
      breakOpinion: z.record(z.enum(['non_aggression', 'safe_passage', 'mutual_defense', 'route_share', 'local_truce', 'income_share']), z.number()),
      /** Ignoring a mutual defense call when you could have come. */
      ignoredCallOpinion: z.number(),
      truceBreakCredibility: z.number().nonnegative(),
      secretDiscoveryPerDay: pct,
      secretDiscoveredOpinion: z.number(),
      maxRouteShare: pct,
      ai: z.object({
        opinionPerPoint: z.number().positive(),
        cashPerPoint: z.number().positive(),
        /** Score an AI needs to accept each pact. */
        threshold: z.record(z.enum(['non_aggression', 'safe_passage', 'mutual_defense', 'route_share', 'local_truce', 'income_share']), z.number()),
        /** Points for feeling outgunned by the proposer (non-aggression): when its men are below this share of the proposer's. */
        weakerBonus: z.number(),
        weakerRatio: pct,
        /** An AI offers mutual defense only to neighbors who think at least this well of it. */
        minOpinionToOffer: z.number(),
        /** Points per 10 Exhaustion (local truce). */
        exhaustionPer10: z.number(),
        /** Daily chance an AI lieutenant proposes a pact. */
        proposeDailyChance: pct,
      }),
    }),
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
      /** Daily chance to plant an informant in the war target when intel on it is thin. */
      informantDailyChance: pct,
      /** Daily chance to fly a drone over the war target when intel on it is stale. */
      droneTownDailyChance: pct,
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
    /** Training, weapons, veterans, and mercenaries: weeks of bills kept back before each. */
    forces: z.object({
      trainReserveWeeks: z.number().nonnegative(),
      trainBudgetDays: z.number().positive(),
      weaponsTargetGear: z.number().int().min(1).max(5),
      weaponsReserveWeeks: z.number().nonnegative(),
      veteransReserveWeeks: z.number().nonnegative(),
      mercReserveWeeks: z.number().nonnegative(),
      /** Hire mercenaries when a plaza of theirs saw fighting this recently. */
      mercAfterBattleDays: z.number().nonnegative(),
      mercMen: z.number().int().positive(),
      /** New weekly pay is taken on only if last week's income covers bills plus this multiple of it (0: no check). */
      payCover: z.number().nonnegative(),
    }),
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
      /** AI joint operations and pacts. */
      coalition: z.boolean(),
      outside: z.boolean(),
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
      /** Plans against most likely + this share of the way to the top of the range. */
      rangeCaution: pct,
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
    /** Refusing to help defend a plaza that then falls. */
    leftExposedOpinion: z.number(),
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
