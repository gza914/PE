/**
 * The State as a third force (GDD "The State"). It cannot be beaten, only
 * bribed, used, dodged, or provoked.
 *
 * - Calentura sets each region's tier: normal, elevated, surge, occupation.
 *   Tiers set military presence, checkpoint odds on roads, army raids on labs
 *   and stash houses (surge and up), and the occupation signature penalty.
 * - Commanders can be bribed per region; they rotate every ~45 days and the
 *   bribe is lost. Police on the payroll give tips (raid warnings) and extra
 *   halcón coverage.
 * - High-profile characters fill a state intel meter; at 100 the State runs a
 *   capture operation (fight, flee, or surrender). Jail ends in a bribe, a
 *   breakout, or extradition.
 *
 * Army units are not on the map: clashes with the State resolve at once
 * (militaryClash) rather than as hour-by-hour battles.
 */
import type { Content } from '../../data/content';
import type { RoadType } from '../../data/schemas';
import { pushFeed, tellSide, type SimContext } from '../context';
import { cashOf, spend, spendUpTo } from '../money';
import { crewNetwork, networkOf } from '../network';
import { addOpinion } from '../opinion';
import { charName } from '../orders';
import { chance, rand, randRange } from '../rng';
import type { CrewState, Id, NetworkId } from '../state';
import { traitProduct } from '../traits';
import { world } from '../world';
import { killCharacter } from './characters';
import { fireById, homeRegion, scheduleEvent } from './events';
import type { SystemEventId } from '../../data/content';

export const TIERS = ['normal', 'elevated', 'surge', 'occupation'] as const;
export type Tier = (typeof TIERS)[number];

export function tierOf(content: Content, calentura: number): Tier {
  const t = content.tuning.state.tiers;
  if (calentura >= t.occupation) return 'occupation';
  if (calentura >= t.surge) return 'surge';
  if (calentura >= t.elevated) return 'elevated';
  return 'normal';
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

function regionOf(ctx: SimContext, node: Id): Id {
  return world(ctx.content).node(node).region;
}

/** Has this network bribed the region's commander, and is the bribe still good? */
export function commanderBribed(ctx: SimContext, region: Id, net: NetworkId): boolean {
  const r = ctx.state.regions[region];
  return !!r && r.commanderBribedBy === net && r.commanderBribedUntil !== null && r.commanderBribedUntil > ctx.state.hour;
}

export function hasPolice(ctx: SimContext, owner: Id, region: Id): boolean {
  return ctx.state.police.some((p) => p.owner === owner && p.region === region && p.until > ctx.state.hour);
}

export function lyingLow(ctx: SimContext, owner: Id, region: Id): boolean {
  return ctx.state.lieLow.some((l) => l.owner === owner && l.region === region && l.until > ctx.state.hour);
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

export function runStateForcesDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const s = content.tuning.state;
  const w = world(content);
  state.lieLow = state.lieLow.filter((l) => l.until > state.hour);
  state.police = state.police.filter((p) => p.until > state.hour);

  for (const id of Object.keys(state.regions).sort()) {
    const r = state.regions[id]!;
    // Lying low cools a region faster, whether or not there was fighting.
    if (state.lieLow.some((l) => l.region === id)) r.calentura = clamp(r.calentura - s.lieLow.extraDecayPerDay);
    if (r.commanderBribedUntil !== null && r.commanderBribedUntil <= state.hour) r.commanderBribedUntil = null;
    if (state.hour >= r.commanderRotatesAt) {
      r.commanderRotatesAt += s.commanderRotationDays * 24;
      if (r.commanderBribedUntil !== null) {
        r.commanderBribedUntil = null;
        const net = r.commanderBribedBy;
        if (net) pushFeed(state, 'important', `The army commander in ${content.regions.find((x) => x.id === id)?.name ?? id} has been rotated out, and our side's arrangement went with him.`, null, net);
      }
    }
  }
  // Military presence follows the tier (never below the map's baseline).
  for (const nodeId of Object.keys(state.nodes).sort()) {
    const r = state.regions[w.node(nodeId).region];
    if (!r) continue;
    state.nodes[nodeId]!.militaryPresence = Math.max(w.node(nodeId).militaryPresence, TIERS.indexOf(tierOf(content, r.calentura)));
  }
  if (!s.enabled) return;
  planRaids(ctx);
  runCaptureOps(ctx);
  runJails(ctx);
}

/** In a surge, the army goes after labs and stash houses. */
function planRaids(ctx: SimContext): void {
  const { state, content } = ctx;
  const s = content.tuning.state;
  const w = world(content);
  for (const id of Object.keys(state.nodes).sort()) {
    const p = state.nodes[id]!;
    if (!p.owner || state.characters[p.owner]?.status !== 'free') continue;
    const region = w.node(id).region;
    const tier = tierOf(content, state.regions[region]?.calentura ?? 0);
    if (tier !== 'surge' && tier !== 'occupation') continue;
    const lab = p.labs > 0;
    const stash = p.stash >= s.raids.stashMin;
    if (!lab && !stash) continue;
    if (state.scheduledEvents.some((e) => e.scope === id && (e.event === 'army_lab_raid' || e.event === 'stash_house_raided'))) continue;
    if (state.pendingEvents.some((e) => e.scope === id)) continue;
    const bribed = commanderBribed(ctx, region, networkOf(state, p.owner));
    const odds = s.raids.dailyChance[tier] * (bribed ? s.raids.bribedMultiplier : 1);
    if (!chance(state.rng, odds)) continue;
    const target: 'lab' | 'stash' = lab && (!stash || rand(state.rng) < 0.5) ? 'lab' : 'stash';
    raidPlaza(ctx, id, target);
  }
}

/** The army moves on a plaza: owners with police there get a warning first. */
export function raidPlaza(ctx: SimContext, node: Id, target: 'lab' | 'stash'): void {
  const { state, content } = ctx;
  const p = state.nodes[node];
  if (!p?.owner) return;
  const region = regionOf(ctx, node);
  const raid: SystemEventId = target === 'lab' ? 'army_lab_raid' : 'stash_house_raided';
  const warning: SystemEventId = target === 'lab' ? 'lab_raid_warning' : 'stash_house_warning';
  if (hasPolice(ctx, p.owner, region) && fireById(ctx, warning, node, p.owner)) return;
  scheduleEvent(ctx, raid, node, p.owner, null, state.hour + content.tuning.state.raids.leadHours);
}

/** High profiles fill the State's intel meter; at the top it comes for them. */
function runCaptureOps(ctx: SimContext): void {
  const { state, content } = ctx;
  const s = content.tuning.state;
  const c = s.captureOps;
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.status !== 'free') continue;
    if (ch.profile > s.captureOpProfileThreshold) {
      const region = homeRegion(state, content, id);
      const heat = region ? (state.regions[region]?.calentura ?? 0) : 0;
      const guards = ch.homePlaza ? Object.values(state.crews).filter((x) => x.owner === id && x.location.kind === 'node' && x.location.node === ch.homePlaza).length : 0;
      let gain = (ch.profile - s.captureOpProfileThreshold) * c.intelPerProfilePoint * (1 + heat / 100);
      gain *= traitProduct(state, content, id, 'stateIntelMultiplier');
      gain *= Math.max(0.3, 1 - c.escortSlowdown * guards);
      ch.stateIntel = clamp(ch.stateIntel + gain);
    } else {
      ch.stateIntel = clamp(ch.stateIntel - c.decayPerDay);
    }
    if (ch.stateIntel >= s.captureOpIntelThreshold && !state.pendingEvents.some((e) => e.event === 'capture_operation' && e.scope === id)) {
      fireById(ctx, 'capture_operation', id, id, null, true);
    }
  }
}

function runJails(ctx: SimContext): void {
  const { state, content } = ctx;
  const days = content.tuning.characters.extraditionDays;
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.status === 'jailed' && state.hour - ch.statusSince >= days * 24) killCharacter(ctx, id, 'extradited');
  }
}

// ---------------------------------------------------------------------------
// Clashes, capture, and jail
// ---------------------------------------------------------------------------

/**
 * A fight with the army, resolved at once: every crew the character has at
 * the spot (or in the region) loses men, leaders may be taken, and the whole
 * state heats up.
 */
export function militaryClash(ctx: SimContext, who: Id, region: Id | null, node: Id | null): void {
  const { state, content } = ctx;
  const m = content.tuning.state.militaryClash;
  const w = world(content);
  const here = (c: CrewState) =>
    c.location.kind === 'node' && (node ? c.location.node === node : region !== null && w.node(c.location.node).region === region);
  const crews = Object.keys(state.crews)
    .sort()
    .map((id) => state.crews[id]!)
    .filter((c) => c.owner === who && c.battle === null && here(c));
  let lost = 0;
  for (const c of crews) {
    const n = Math.max(1, Math.round(c.men * randRange(state.rng, m.lossShareMin, m.lossShareMax)));
    const cut = Math.min(n, c.men - 1);
    c.men -= cut;
    lost += cut;
    c.morale = clamp(c.morale - 10);
    if (c.leader !== who && state.characters[c.leader]?.status === 'free' && chance(state.rng, m.leaderCaptureChance)) jail(ctx, c.leader);
  }
  const r = region ? state.regions[region] : undefined;
  if (r) r.calentura = clamp(r.calentura + m.calentura);
  for (const other of Object.values(state.regions)) if (other !== r) other.calentura = clamp(other.calentura + content.tuning.state.statewideSurgeCalentura);
  const name = region ? (content.regions.find((x) => x.id === region)?.name ?? region) : 'the state';
  pushFeed(state, 'critical', `${charName(ctx, who)}'s people fought the army in ${name}${lost ? `: ${lost} men lost` : ''}. The whole state is on alert.`, node, null);
}

/** Puts a character in a federal prison. */
export function jail(ctx: SimContext, id: Id): void {
  const { state, content } = ctx;
  const ch = state.characters[id];
  if (!ch || ch.status !== 'free') return;
  ch.status = 'jailed';
  ch.statusSince = state.hour;
  ch.captor = null;
  pushFeed(state, 'critical', `${charName(ctx, id)} is in federal custody. Extradition in about ${content.tuning.characters.extraditionDays} days unless someone acts.`, ch.homePlaza, null);
}

/** How a capture operation ends (the capture_operation event's options). */
export function resolveCapture(ctx: SimContext, id: Id, choice: 'fight' | 'flee' | 'surrender'): void {
  const { state, content } = ctx;
  const c = content.tuning.state.captureOps;
  const ch = state.characters[id];
  if (!ch || ch.status !== 'free') return;
  const escaped = () => {
    ch.stateIntel = c.intelAfterEscape;
    pushFeed(state, 'critical', `${charName(ctx, id)} slipped the net.`, ch.homePlaza, null);
  };
  switch (choice) {
    case 'fight':
      militaryClash(ctx, id, homeRegion(state, content, id), ch.homePlaza);
      if (chance(state.rng, c.fightEscapeChance)) escaped();
      else jail(ctx, id);
      break;
    case 'flee': {
      const lost = spendUpTo(state, content, id, cashOf(state, id) * c.fleeCashLossShare, 'seized');
      ch.profile = clamp(ch.profile - 10);
      escaped();
      if (lost > 0 && id === state.playerId) pushFeed(state, 'important', `The run cost you $${Math.round(lost).toLocaleString()} left behind.`, null, null);
      break;
    }
    case 'surrender':
      jail(ctx, id);
      break;
  }
}

function release(ctx: SimContext, id: Id, how: string): void {
  const { state, content } = ctx;
  const ch = state.characters[id]!;
  ch.status = 'free';
  ch.statusSince = state.hour;
  ch.stateIntel = content.tuning.state.captureOps.intelAfterEscape;
  pushFeed(state, 'critical', `${charName(ctx, id)} is out of prison: ${how}.`, ch.homePlaza, null);
}

/** Pay the judge and the warden: a good chance, and the money is gone either way. */
export function jailBribe(ctx: SimContext, jailed: Id, payer: Id): void {
  const { state, content } = ctx;
  const c = content.tuning.state.captureOps;
  if (state.characters[jailed]?.status !== 'jailed') return;
  if (!spend(state, content, payer, c.jailBribeCost, 'bribes')) return;
  if (chance(state.rng, c.jailBribeChance)) release(ctx, jailed, 'the paperwork got lost');
  else tellSide(state, payer, 'important', `Your bribe for ${charName(ctx, jailed)} was taken, and nothing happened.`, (n) => `${n}'s bribe for ${charName(ctx, jailed)} was taken, and nothing happened.`);
}

/** A breakout: risky, loud, and a fight with the army either way. */
export function jailBreakout(ctx: SimContext, jailed: Id, organizer: Id): void {
  const { state, content } = ctx;
  if (state.characters[jailed]?.status !== 'jailed') return;
  militaryClash(ctx, organizer, homeRegion(state, content, jailed), null);
  if (chance(state.rng, content.tuning.state.captureOps.breakoutChance)) release(ctx, jailed, 'broken out in a hail of gunfire');
  else pushFeed(state, 'critical', `The breakout for ${charName(ctx, jailed)} failed.`, null, null);
}

// ---------------------------------------------------------------------------
// Checkpoints (called by movement when a group takes a road)
// ---------------------------------------------------------------------------

/** Rolls a State checkpoint for a group leaving `node` on a road. Returns true if it was stopped. */
export function checkpointStop(ctx: SimContext, group: CrewState[], node: Id, roadType: RoadType): boolean {
  const { state, content } = ctx;
  const s = content.tuning.state;
  if (!s.enabled || !group.length) return false;
  const region = regionOf(ctx, node);
  const tier = tierOf(content, state.regions[region]?.calentura ?? 0);
  const net = crewNetwork(state, group[0]!);
  const odds = (s.checkpoints.chance[tier]?.[roadType] ?? 0) * (commanderBribed(ctx, region, net) ? s.checkpoints.bribedMultiplier : 1);
  if (odds <= 0 || !chance(state.rng, odds)) return false;
  const lead = group[0]!;
  lead.transit.waitUntil = state.hour + s.checkpoints.delayHours;
  const vehicles = group.reduce((n, c) => n + c.vehicles.pickup + c.vehicles.suv + c.vehicles.motorcycle + c.vehicles.armored, 0);
  const fee = spendUpTo(state, content, lead.owner, vehicles * s.checkpoints.feePerVehicle, 'bribes');
  const owner = state.characters[lead.owner];
  if (owner) owner.stateIntel = clamp(owner.stateIntel + s.checkpoints.stateIntelPerStop);
  if (lead.owner === state.playerId) {
    pushFeed(state, 'routine', `A ${tier === 'normal' ? '' : `${tier} `}checkpoint outside ${world(content).node(node).name} held your people ${s.checkpoints.delayHours}h and took $${Math.round(fee).toLocaleString()}.`.replace('  ', ' '), node, net);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Player options (commands)
// ---------------------------------------------------------------------------

export type StateCommand =
  | { type: 'bribe_commander'; issuer: Id; region: Id }
  | { type: 'bribe_police'; issuer: Id; region: Id }
  | { type: 'tip_off'; issuer: Id; node: Id }
  | { type: 'hand_over_scapegoat'; issuer: Id; region: Id }
  | { type: 'lie_low_region'; issuer: Id; region: Id };

export function stateCommand(ctx: SimContext, cmd: StateCommand): string | null {
  const { state, content } = ctx;
  const s = content.tuning.state;
  const w = world(content);
  const net = networkOf(state, cmd.issuer);
  const regionName = (id: Id) => content.regions.find((r) => r.id === id)?.name ?? id;
  if (cmd.type !== 'tip_off' && !state.regions[cmd.region]) return `unknown region "${cmd.region}"`;
  switch (cmd.type) {
    case 'bribe_commander': {
      if (commanderBribed(ctx, cmd.region, net)) return 'your side already has the commander';
      const left = (state.regions[cmd.region]!.commanderRotatesAt - state.hour) / 24;
      if (left < s.commanderMinDaysLeft) return `the commander rotates out in ${Math.ceil(left)} days; wait for the new one`;
      if (!spend(state, content, cmd.issuer, s.commanderBribeCost, 'bribes')) return `the commander wants $${s.commanderBribeCost.toLocaleString()}`;
      const r = state.regions[cmd.region]!;
      r.commanderBribedUntil = Math.min(state.hour + s.commanderBribeDays * 24, r.commanderRotatesAt);
      r.commanderBribedBy = net;
      r.commanderBribedAt = state.hour;
      const days = Math.floor((r.commanderBribedUntil - state.hour) / 24);
      tellSide(state, cmd.issuer, 'important', `The army commander in ${regionName(cmd.region)} is yours for ${days} days.`, (n) => `${n} bought the army commander in ${regionName(cmd.region)} for ${days} days.`);
      return null;
    }
    case 'bribe_police': {
      if (hasPolice(ctx, cmd.issuer, cmd.region)) return 'the police there are already on your payroll';
      if (!spend(state, content, cmd.issuer, s.police.cost, 'bribes')) return `the police want $${s.police.cost.toLocaleString()}`;
      state.police.push({ owner: cmd.issuer, region: cmd.region, until: state.hour + s.police.days * 24 });
      return null;
    }
    case 'tip_off': {
      const p = state.nodes[cmd.node];
      if (!p?.owner) return 'no one holds that plaza';
      if (networkOf(state, p.owner) === net) return 'that plaza is your own side’s';
      if (!spend(state, content, cmd.issuer, s.tipOff.cost, 'bribes')) return `a tip costs $${s.tipOff.cost.toLocaleString()}`;
      const target = state.characters[p.owner]!;
      target.stateIntel = clamp(target.stateIntel + s.tipOff.stateIntel);
      if (p.labs > 0 || p.stash >= s.raids.stashMin) raidPlaza(ctx, cmd.node, p.labs > 0 ? 'lab' : 'stash');
      const trace = s.tipOff.traceBaseChance + target.skills.astucia * s.tipOff.tracePerAstucia;
      if (chance(state.rng, trace)) {
        addOpinion(state, content, target.id, cmd.issuer, 'snitched_to_the_army', s.tipOff.traceOpinion, content.tuning.events.opinionDecayDays);
        pushFeed(state, 'important', `${charName(ctx, target.id)} found out who tipped off the army about ${w.node(cmd.node).name}.`, cmd.node, null);
      }
      return null;
    }
    case 'hand_over_scapegoat': {
      const r = state.regions[cmd.region]!;
      if (r.scapegoatAt !== null && state.hour - r.scapegoatAt < s.scapegoat.cooldownDays * 24) return 'the State will not buy another scapegoat here so soon';
      const crew = Object.keys(state.crews)
        .sort()
        .map((id) => state.crews[id]!)
        .find((c) => c.owner === cmd.issuer && c.battle === null && c.location.kind === 'node' && w.node(c.location.node).region === cmd.region && c.men > s.scapegoat.men);
      if (!crew) return `you need a crew in ${regionName(cmd.region)} to give up ${s.scapegoat.men} men`;
      crew.men -= s.scapegoat.men;
      r.calentura = clamp(r.calentura - s.scapegoat.calenturaDrop);
      r.scapegoatAt = state.hour;
      if (crew.leader !== cmd.issuer) addOpinion(state, content, crew.leader, cmd.issuer, 'gave_up_my_men', s.scapegoat.opinion, content.tuning.events.opinionDecayDays);
      tellSide(state, cmd.issuer, 'important', `${s.scapegoat.men} of your men were handed to the State in ${regionName(cmd.region)}. The heat eases.`, (n) => `${n} handed ${s.scapegoat.men} men to the State in ${regionName(cmd.region)}.`);
      return null;
    }
    case 'lie_low_region': {
      if (!Object.values(state.nodes).some((n) => n.owner === cmd.issuer && w.node(n.id).region === cmd.region)) return 'you hold no plaza there';
      if (lyingLow(ctx, cmd.issuer, cmd.region)) return 'you are already lying low there';
      state.lieLow.push({ owner: cmd.issuer, region: cmd.region, until: state.hour + s.lieLow.days * 24 });
      return null;
    }
  }
}

