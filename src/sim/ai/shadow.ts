/**
 * The AI's shadow work, once a day per AI character: dealing with the State
 * (bribing commanders where the army is hot and they have labs or cash, lying
 * low, handing over scapegoats), sending messages (claiming a taken plaza,
 * rally videos, corridos), and schemes and rumors. Everything goes through
 * the player's own commands and reads only public knowledge: who holds which
 * plaza, calentura, and relationships.
 */
import type { SchemeType } from '../../data/schemas';
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { informantBlocked } from '../intel';
import { plazaIntel } from '../knowledge';
import { cashOf } from '../money';
import { networkOf } from '../network';
import { chance, rand } from '../rng';
import type { Id } from '../state';
import { weeklyObligations } from '../systems/economy';
import { schemeBlocked } from '../systems/schemes';
import { commanderBribed, hasPolice, lyingLow, TIERS, tierOf } from '../systems/stateForces';
import { world } from '../world';
import { withinHops } from './intel';
import { actionWeight, cautionOf, isAi, majorFactions, stagger } from './util';

export function runShadow(ctx: SimContext): Command[] {
  const { state } = ctx;
  const cmds: Command[] = [];
  for (const id of Object.keys(state.characters).sort()) {
    if (!isAi(state, id)) continue;
    if ((state.hour + stagger(`shadow:${id}`, 24)) % 24 !== 0) continue;
    cmds.push(...decide(ctx, id));
  }
  return cmds;
}

function decide(ctx: SimContext, id: Id): Command[] {
  const { state, content } = ctx;
  const t = content.tuning.ai.shadow;
  const w = world(content);
  const me = state.characters[id]!;
  const net = networkOf(state, id);
  let cash = cashOf(state, id) - weeklyObligations(state, content, id) * t.reserveWeeks;
  const cmds: Command[] = [];
  const mine = Object.values(state.nodes)
    .filter((n) => n.owner === id)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const regions = [...new Set(mine.map((n) => w.node(n.id).region))].sort();
  const tier = (r: Id) => TIERS.indexOf(tierOf(content, state.regions[r]?.calentura ?? 0));
  const s = content.tuning.state;
  const caution = cautionOf(state, content, id);

  // The State: protect labs and cash where the army is hot.
  for (const r of regions) {
    const exposed = mine.some((n) => w.node(n.id).region === r && (n.labs > 0 || n.stash >= s.raids.stashMin));
    const rotating = (state.regions[r]!.commanderRotatesAt - state.hour) / 24 < s.commanderMinDaysLeft;
    if (exposed && !rotating && tier(r) >= t.bribeCommanderTier && !commanderBribed(ctx, r, net) && cash >= s.commanderBribeCost && actionWeight(state, content, id, 'bribe') >= 1) {
      cmds.push({ type: 'bribe_commander', issuer: id, region: r });
      cash -= s.commanderBribeCost;
    } else if (exposed && tier(r) >= t.bribeCommanderTier - 1 && !hasPolice(ctx, id, r) && cash >= s.police.cost && actionWeight(state, content, id, 'bribe') > 1) {
      cmds.push({ type: 'bribe_police', issuer: id, region: r });
      cash -= s.police.cost;
    }
    if (tier(r) >= t.lieLowTier && !lyingLow(ctx, id, r) && caution * actionWeight(state, content, id, 'lie_low') >= t.lieLowMinWeight) {
      cmds.push({ type: 'lie_low_region', issuer: id, region: r });
    }
    const reg = state.regions[r]!;
    const ready = reg.scapegoatAt === null || state.hour - reg.scapegoatAt >= s.scapegoat.cooldownDays * 24;
    if (tier(r) >= t.scapegoatTier && ready) cmds.push({ type: 'hand_over_scapegoat', issuer: id, region: r });
  }

  // Eyes on the war target: an informant if thin on intel, a drone if stale.
  const target = me.faction !== null ? state.factions[me.faction]?.warPlan.target ?? null : null;
  if (target && !informantBlocked(ctx, id, target)) {
    const known = plazaIntel(state, content, net, target, content.tuning.ai.strategic.intelStaleHours);
    const spyCost = content.tuning.intel.informant.cost;
    const droneCost = content.tuning.intel.droneTown.cost;
    const spying = actionWeight(state, content, id, 'scout');
    if (!known.complete && cash >= spyCost && chance(state.rng, Math.min(1, t.informantDailyChance * spying))) {
      cmds.push({ type: 'plant_informant', issuer: id, node: target });
      cash -= spyCost;
    } else if ((known.age === null || known.age > content.tuning.ai.operational.scoutStaleHours) && cash >= droneCost && chance(state.rng, Math.min(1, t.droneTownDailyChance * spying))) {
      cmds.push({ type: 'launch_drone', issuer: id, node: target });
      cash -= droneCost;
    }
  }

  // Messages.
  const inf = content.tuning.infowar;
  const msgWeight = actionWeight(state, content, id, 'message');
  const taken = mine.find((n) => n.lastBattleAt !== null && state.hour - n.lastBattleAt <= t.claimBannerDays * 24);
  if (taken && cash >= inf.narcomanta.cost && chance(state.rng, Math.min(1, t.claimBannerChance * msgWeight))) {
    cmds.push({ type: 'narcomanta', issuer: id, node: taken.id });
    cash -= inf.narcomanta.cost;
  }
  const isHead = me.faction !== null && state.factions[me.faction]?.head === id;
  if (isHead && cash >= inf.video.cost && (me.lastVideoAt === null || state.hour - me.lastVideoAt >= inf.video.cooldownDays * 24)) {
    const own = Object.values(state.crews).filter((c) => networkOf(state, c.owner) === net);
    const morale = own.length ? own.reduce((n, c) => n + c.morale, 0) / own.length : 100;
    if (morale < t.rallyMoraleBelow && chance(state.rng, Math.min(1, t.rallyDailyChance * msgWeight))) {
      cmds.push({ type: 'video', issuer: id, tone: 'rally' });
      cash -= inf.video.cost;
    }
  }
  if ((me.corridoUntil === null || me.corridoUntil <= state.hour) && cash >= inf.corrido.cost * t.corridoCashMultiple && chance(state.rng, Math.min(1, t.messageDailyChance * msgWeight))) {
    cmds.push({ type: 'commission_corrido', issuer: id });
    cash -= inf.corrido.cost;
  }

  // Schemes: at most one new one a day.
  const schemeWeight = actionWeight(state, content, id, 'scheme');
  if (chance(state.rng, Math.min(1, t.schemeDailyChance * schemeWeight))) {
    const plan = pickScheme(ctx, id);
    if (plan && cash >= content.tuning.schemes.types[plan.type].cost) {
      cmds.push({ type: 'start_scheme', issuer: id, scheme: plan.type, target: plan.target });
      cash -= content.tuning.schemes.types[plan.type].cost;
    }
  }

  // Rumors: poison a rival head against one of his lieutenants.
  const rumoring = state.rumors.some((r) => r.owner === id && r.until > state.hour);
  if (me.faction !== null && !rumoring && cash >= inf.rumor.cost && chance(state.rng, Math.min(1, t.rumorDailyChance * schemeWeight))) {
    const rival = majorFactions(content).find((f) => f !== net);
    const subjects = rival ? rivalLieutenants(ctx, rival) : [];
    if (rival && subjects.length) {
      cmds.push({ type: 'plant_rumor', issuer: id, network: rival, kind: 'fake_betrayal', subject: subjects[Math.floor(rand(state.rng) * subjects.length)]! });
    }
  }
  return cmds;
}

function rivalLieutenants(ctx: SimContext, faction: Id): Id[] {
  const { state } = ctx;
  return Object.values(state.characters)
    .filter((c) => c.faction === faction && c.status === 'free' && state.factions[faction]?.head !== c.id && (c.rank === 'lieutenant' || c.rank === 'senior_lieutenant'))
    .map((c) => c.id)
    .sort();
}

/** A scheme worth running: vengeance first, then turning or blinding a neighbor. */
function pickScheme(ctx: SimContext, id: Id): { type: SchemeType; target: Id } | null {
  const { state, content } = ctx;
  const me = state.characters[id]!;
  const ok = (type: SchemeType, target: Id) => (schemeBlocked(ctx, id, type, target) === null ? { type, target } : null);
  // Vengeance.
  for (const r of me.relations) {
    if (r.type !== 'vendetta') continue;
    const plan = ok('assassinate', r.target);
    if (plan) return plan;
  }
  // Neighbors on the other side: rival plazas within two roads of ours.
  const net = networkOf(state, id);
  const near = new Set<Id>();
  for (const n of Object.values(state.nodes)) {
    if (n.owner !== id) continue;
    for (const x of withinHops(content, n.id, 2)) {
      const o = state.nodes[x]?.owner;
      if (o && networkOf(state, o) !== net) near.add(x);
    }
  }
  const plazas = [...near].sort();
  if (!plazas.length) return null;
  const pickPlaza = plazas[Math.floor(rand(state.rng) * plazas.length)]!;
  const owner = state.nodes[pickPlaza]!.owner!;
  const mix = content.tuning.ai.shadow.schemeMix;
  const roll = rand(state.rng);
  if (me.faction !== null && roll < mix.flip) return ok('flip', owner) ?? ok('buy_halcones', pickPlaza);
  if (roll < mix.flip + mix.buyHalcones) return ok('buy_halcones', pickPlaza);
  return ok(me.traits.includes('sanguinario') ? 'assassinate' : 'frame', owner);
}
