/**
 * Strategic layer: faction heads, once a day (GDD "AI", "Faction war plans").
 *
 * A head reads the faction's pulse (Supply, Exhaustion), looks for threatened
 * plazas, and picks a war plan: regroup when exhausted, defend when a plaza is
 * threatened, attack when rested and supplied. An attack is a coordinated
 * offensive: the head picks the best target it can take, gathers crews from
 * across the faction, and sets one arrival hour so they hit together. The
 * head commands its own crews directly and sends requests to everyone else,
 * the player included. Offensives are then tracked hourly until they are won,
 * lost, or called off.
 */
import { rivalPlazaIds, type Command } from '../commands';
import { newId, pushFeed, type SimContext } from '../context';
import { groupOf } from '../crews';
import { cashOf, deposit, spend } from '../money';
import { crewNetwork, networkOf, ownedBy } from '../network';
import { charName } from '../orders';
import { groupPower } from '../power';
import { cancelOffensiveRequests, createRequest, mayAsk, onDuty, settleOffensiveRequests } from '../requests';
import { travelHours } from '../routing';
import type { CrewState, FactionState, Id, NetworkId, Offensive } from '../state';
import { nodeValue, weeklyObligations } from '../systems/economy';
import { world } from '../world';
import { withinHops, type Intel } from './intel';
import { cautionOf, isAi, majorFactions } from './util';

/** Crews that are not tied up and could be sent somewhere. */
function freeCrews(ctx: SimContext, net: NetworkId): CrewState[] {
  const { state } = ctx;
  const busy = new Set(state.offensives.filter((o) => o.status === 'gathering' || o.status === 'assault').flatMap((o) => o.crews));
  return Object.values(state.crews)
    .filter(
      (c) =>
        crewNetwork(state, c) === net &&
        state.characters[c.owner]?.status === 'free' &&
        c.battle === null &&
        c.colonia === null &&
        c.location.kind === 'node' &&
        (c.order.type === 'garrison' || c.order.type === 'idle') &&
        !busy.has(c.id) &&
        !onDuty(state, c.id) &&
        // Faction heads direct the war; the crews they lead in person stay home.
        !(c.leader === c.owner && state.factions[net]?.head === c.owner),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Is this rival-facing? A plaza with a rival plaza within two roads keeps a garrison. */
function frontline(ctx: SimContext, net: NetworkId, node: Id): boolean {
  const { state, content } = ctx;
  for (const n of withinHops(content, node, 2)) {
    const owner = state.nodes[n]?.owner;
    if (owner && networkOf(state, owner) !== net) return true;
  }
  return false;
}

/** Crews that can leave: not the last defender of a frontline plaza their side holds. */
export function detachable(ctx: SimContext, net: NetworkId, crews: CrewState[]): CrewState[] {
  const { state } = ctx;
  const byNode = new Map<Id, CrewState[]>();
  for (const c of crews) {
    const n = (c.location as { node: Id }).node;
    byNode.set(n, [...(byNode.get(n) ?? []), c]);
  }
  const out: CrewState[] = [];
  for (const [node, here] of [...byNode].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const guarded = ownedBy(state, node, net) && frontline(ctx, net, node);
    // Keep the biggest crew home at a guarded plaza; the rest may go.
    const sorted = [...here].sort((a, b) => b.men - a.men || (a.id < b.id ? -1 : 1));
    out.push(...(guarded ? sorted.slice(1) : sorted));
  }
  return out;
}

export interface Threat {
  node: Id;
  enemy: number;
  garrison: number;
  value: number;
}

/** Plazas where believed nearby enemy strength outweighs the garrison. */
export function threats(ctx: SimContext, intel: Intel, net: NetworkId): Threat[] {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const out: Threat[] = [];
  for (const n of content.nodes) {
    if (!ownedBy(state, n.id, net)) continue;
    const enemy = intel.nearbyEnemy(net, n.id, s.threatHops, s.threatRecentHours);
    if (enemy <= 0) continue;
    const garrison = intel.defense(net, n.id).power;
    if (enemy > garrison * s.defendRatio) out.push({ node: n.id, enemy, garrison, value: nodeValue(state, content, n.id) });
  }
  return out.sort((a, b) => b.value - a.value || (a.node < b.node ? -1 : 1));
}

export function activeOffensive(ctx: SimContext, faction: NetworkId): Offensive | undefined {
  return ctx.state.offensives.find((o) => o.faction === faction && (o.status === 'gathering' || o.status === 'assault'));
}

export function runStrategic(ctx: SimContext, intel: Intel): Command[] {
  const { state, content } = ctx;
  const cmds: Command[] = [...updateOffensives(ctx)];
  if (state.hour % 24 !== content.tuning.ai.strategic.hourOfDay) return cmds;
  for (const f of majorFactions(content)) {
    const fs = state.factions[f]!;
    if (!fs.head || !isAi(state, fs.head)) continue;
    cmds.push(...planFaction(ctx, intel, fs));
  }
  return cmds;
}

function setPlan(ctx: SimContext, fs: FactionState, mode: FactionState['warPlan']['mode'], focusRegion: Id | null, target: Id | null): void {
  const p = fs.warPlan;
  if (p.mode !== mode || p.focusRegion !== focusRegion) p.since = ctx.state.hour;
  p.mode = mode;
  p.focusRegion = focusRegion;
  p.target = target;
}

function planFaction(ctx: SimContext, intel: Intel, fs: FactionState): Command[] {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const head = fs.head!;
  const cmds: Command[] = [];
  const w = world(content);

  // Exhausted: every offensive halts and the crews pull back.
  if (fs.exhaustion >= content.tuning.pulse.allOffensivesHaltAtExhaustion) {
    const o = activeOffensive(ctx, fs.id);
    if (o) cmds.push(...endOffensive(ctx, o, 'cancelled'));
    setPlan(ctx, fs, 'regroup', null, null);
    return cmds;
  }

  cmds.push(...levy(ctx, fs));
  supportBroke(ctx, fs);
  cmds.push(...culiacanPressure(ctx, fs));

  const threatened = threats(ctx, intel, fs.id);
  // Minor threats (small next to what the faction could send) are handled locally and don't stop an attack.
  const freePower = groupPower(state, content, freeCrews(ctx, fs.id));
  const serious = threatened.filter((t) => t.enemy - t.garrison > freePower * s.minorThreatShare);
  if (serious.length || (threatened.length && freePower <= 0)) {
    const t = (serious[0] ?? threatened[0])!;
    setPlan(ctx, fs, 'defend', w.node(t.node).region, t.node);
    cmds.push(...sendDefenders(ctx, fs, t));
    return cmds;
  }
  for (const t of threatened) cmds.push(...sendDefenders(ctx, fs, t));

  const rested =
    fs.exhaustion < content.tuning.pulse.aiNoMajorOffensiveAboveExhaustion && fs.supply >= s.offensiveMinSupply && state.hour >= s.firstOffensiveDay * 24;
  const cooled = fs.warPlan.lastOffensiveEndedAt === null || state.hour - fs.warPlan.lastOffensiveEndedAt >= s.offensiveCooldownHours;
  if (!rested || !cooled || activeOffensive(ctx, fs.id)) {
    if (!activeOffensive(ctx, fs.id)) setPlan(ctx, fs, 'defend', null, null);
    return cmds;
  }
  const plan = pickOffensive(ctx, intel, fs);
  if (!plan) {
    setPlan(ctx, fs, 'defend', null, null);
    return cmds;
  }
  setPlan(ctx, fs, 'attack', w.node(plan.target).region, plan.target);
  cmds.push(...launchOffensive(ctx, fs, head, plan));
  return cmds;
}

interface OffensivePlan {
  target: Id;
  crews: CrewState[];
  arriveAt: number;
  score: number;
}

/** The best rival plaza the faction can gather enough force to take. */
export function pickOffensive(ctx: SimContext, intel: Intel, fs: FactionState): OffensivePlan | null {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const w = world(content);
  const cooldown = content.tuning.ai.requests.repeatCooldownHours;
  const pool = detachable(ctx, fs.id, freeCrews(ctx, fs.id)).filter((c) => c.owner === fs.head || mayAsk(state, fs.head!, c.owner, cooldown));
  if (!pool.length) return null;
  // One route search per crew, reused for every target.
  const hours = new Map<Id, Map<Id, number>>();
  for (const c of pool) {
    hours.set(c.id, travelHours(state, content, { crews: groupOf(state, c), from: c.location, preference: 'fastest', departHour: state.hour, viewer: fs.id, noPassThrough: rivalPlazaIds(state, fs.id) }));
  }
  const rivals = new Set(majorFactions(content).filter((f) => f !== fs.id));
  const caution = cautionOf(state, content, fs.head!);
  const neutralsFair = state.hour >= s.neutralTargetDay * 24;
  let best: OffensivePlan | null = null;
  for (const n of content.nodes) {
    const owner = state.nodes[n.id]!.owner;
    if (!owner || n.type === 'border_exit' || n.id === content.culiacan.parentNode) continue;
    const ownerNet = networkOf(state, owner);
    const neutral = state.characters[owner]?.faction === null;
    if (!rivals.has(ownerNet) && !(neutral && neutralsFair)) continue;
    const est = intel.defense(fs.id, n.id);
    // A cautious head gathers a bigger margin rather than refusing to attack.
    const need = Math.max(est.power * s.attackForceRatio * (1 + (caution - 1) * s.cautionForceWeight), 1);
    const reach = pool
      .map((c) => ({ c, h: hours.get(c.id)!.get(n.id) ?? Infinity }))
      .filter((x) => x.h <= s.maxParticipantHours)
      .sort((a, b) => a.h - b.h || (a.c.id < b.c.id ? -1 : 1));
    const chosen: CrewState[] = [];
    let power = 0;
    let maxH = 0;
    for (const { c, h } of reach) {
      if (power >= need) break;
      chosen.push(c);
      power += groupPower(state, content, groupOf(state, c));
      maxH = Math.max(maxH, h);
    }
    if (power < need) continue;
    let score = nodeValue(state, content, n.id) / s.valuePerScorePoint - maxH * s.hourPenalty - est.power * s.riskPenalty * caution;
    if (fs.warPlan.focusRegion === n.region) score += s.focusBonus;
    if (neutral) score += s.neutralTargetBonus;
    if (fs.warPlan.lost.some((l) => l.node === n.id && state.hour - l.at <= s.retakeWindowDays * 24)) score += s.retakeBonus;
    // Cutting a rival route near its source hurts twice.
    for (const r of content.routes) {
      const src = state.nodes[r.nodes[0]!]?.owner;
      if (r.nodes.includes(n.id) && src && rivals.has(networkOf(state, src))) score += s.routeCutBonus * (r.dailyValue / s.valuePerScorePoint / 10);
    }
    if (!best || score > best.score || (score === best.score && n.id < best.target)) {
      best = { target: n.id, crews: chosen, arriveAt: state.hour + Math.ceil(maxH) + s.responseHours + s.slackHours, score };
    }
  }
  return best && best.score > 0 ? best : null;
}

function launchOffensive(ctx: SimContext, fs: FactionState, head: Id, plan: OffensivePlan): Command[] {
  const { state, content } = ctx;
  const w = world(content);
  const o: Offensive = {
    id: newId(state, 'off'),
    faction: fs.id,
    target: plan.target,
    region: w.node(plan.target).region,
    arriveAt: plan.arriveAt,
    createdAt: state.hour,
    status: 'gathering',
    battle: null,
    crews: plan.crews.map((c) => c.id),
    endedAt: null,
  };
  state.offensives.push(o);
  const cmds: Command[] = [];
  const byOwner = new Map<Id, CrewState[]>();
  for (const c of plan.crews) byOwner.set(c.owner, [...(byOwner.get(c.owner) ?? []), c]);
  for (const [owner, crews] of [...byOwner].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (owner === head) {
      for (const c of crews) cmds.push({ type: 'order_crew', issuer: head, crew: c.id, order: { type: 'raid', target: plan.target, preference: 'fastest', arriveAt: plan.arriveAt, avoidRivalPlazas: true } });
    } else {
      createRequest(ctx, { faction: fs.id, from: head, to: owner, kind: 'join_offensive', target: plan.target, crews: crews.map((c) => c.id), arriveBy: plan.arriveAt, offensive: o.id });
    }
  }
  const men = plan.crews.reduce((n, c) => n + c.men, 0);
  pushFeed(state, 'important', `${charName(ctx, head)} orders an attack on ${w.node(plan.target).name}: ${men} men, hitting at hour ${plan.arriveAt % 24}:00 on day ${Math.floor(plan.arriveAt / 24)}.`, plan.target, fs.id);
  return cmds;
}

/** Hourly: follow each offensive from gathering to assault to its end. */
function updateOffensives(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const cmds: Command[] = [];
  for (const o of state.offensives) {
    if (o.status !== 'gathering' && o.status !== 'assault') continue;
    const owner = state.nodes[o.target]?.owner;
    const held = !!owner && networkOf(state, owner) === o.faction;
    const battle = Object.values(state.battles)
      .filter((b) => b.where.kind === 'node' && b.where.node === o.target && b.colonia === null && b.attackers.network === o.faction && b.startedAt >= o.createdAt)
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (battle && o.status === 'gathering') {
      o.status = 'assault';
      o.battle = battle.id;
    }
    if (held) cmds.push(...endOffensive(ctx, o, 'won'));
    else if (o.status === 'assault' && battle && battle.endedAt !== null && !Object.values(state.battles).some((b) => b.endedAt === null && b.where.kind === 'node' && b.where.node === o.target && b.attackers.network === o.faction)) {
      cmds.push(...endOffensive(ctx, o, 'lost'));
    } else if (o.status === 'gathering' && state.hour > o.arriveAt + s.offensiveTimeoutHours) cmds.push(...endOffensive(ctx, o, 'cancelled'));
  }
  // Keep a short history for the UI.
  state.offensives = state.offensives.filter((o) => o.endedAt === null || state.hour - o.endedAt <= content.tuning.ai.requests.keepHours);
  return cmds;
}

function endOffensive(ctx: SimContext, o: Offensive, status: 'won' | 'lost' | 'cancelled'): Command[] {
  const { state, content } = ctx;
  o.status = status;
  o.endedAt = state.hour;
  const fs = state.factions[o.faction]!;
  fs.warPlan.lastOffensiveEndedAt = state.hour;
  const b = o.battle ? state.battles[o.battle] : undefined;
  const fought = new Set<Id>([...(b?.attackers.owners ?? [])]);
  // Crews that reached the target also count (an unopposed capture has no battle).
  for (const id of o.crews) {
    const c = state.crews[id];
    if (c && c.location.kind === 'node' && c.location.node === o.target) fought.add(c.owner);
  }
  if (status === 'cancelled') cancelOffensiveRequests(ctx, o.id);
  else settleOffensiveRequests(ctx, o.id, fought, status === 'won');
  const cmds: Command[] = [];
  // Recall AI crews still on their way.
  for (const id of o.crews) {
    const c = state.crews[id];
    if (!c || c.battle !== null || !isAi(state, c.owner)) continue;
    if (c.order.type === 'raid' && c.order.target === o.target) cmds.push({ type: 'order_crew', issuer: c.owner, crew: c.id, order: { type: 'retreat' } });
  }
  const name = world(content).node(o.target).name;
  const text = { won: `We took ${name}.`, lost: `The attack on ${name} failed.`, cancelled: `The attack on ${name} is called off.` }[status];
  pushFeed(state, status === 'won' ? 'important' : 'routine', text, o.target, o.faction);
  return cmds;
}

/** Send the nearest free crews to a threatened plaza: the head's own directly, others by request. */
function sendDefenders(ctx: SimContext, fs: FactionState, t: Threat): Command[] {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const head = fs.head!;
  const already = state.requests.some((r) => r.faction === fs.id && r.kind === 'defend' && r.target === t.node && (r.status === 'pending' || r.status === 'accepted'));
  if (already) return [];
  const cooldown = content.tuning.ai.requests.repeatCooldownHours;
  const pool = detachable(ctx, fs.id, freeCrews(ctx, fs.id)).filter(
    (c) => (c.location as { node: Id }).node !== t.node && (c.owner === head || mayAsk(state, head, c.owner, cooldown)),
  );
  const ranked = pool
    .map((c) => ({ c, h: travelHours(state, content, { crews: groupOf(state, c), from: c.location, preference: 'fastest', departHour: state.hour, viewer: fs.id, noPassThrough: rivalPlazaIds(state, fs.id) }).get(t.node) ?? Infinity }))
    .filter((x) => x.h <= s.maxParticipantHours)
    .sort((a, b) => a.h - b.h || (a.c.id < b.c.id ? -1 : 1));
  const cmds: Command[] = [];
  let sent = 0;
  let power = t.garrison;
  for (const { c, h } of ranked) {
    if (sent >= s.maxDefendRequests || power >= t.enemy * s.defendRatio) break;
    power += groupPower(state, content, groupOf(state, c));
    sent++;
    if (c.owner === head) cmds.push({ type: 'order_crew', issuer: head, crew: c.id, order: { type: 'move', destination: t.node, preference: 'fastest', avoidRivalPlazas: true } });
    else createRequest(ctx, { faction: fs.id, from: head, to: c.owner, kind: 'defend', target: t.node, crews: [c.id], arriveBy: state.hour + Math.ceil(h) + s.responseHours + s.slackHours });
  }
  return cmds;
}

/** Culiacán never goes quiet: keep crews committed in its contested colonias. */
function culiacanPressure(ctx: SimContext, fs: FactionState): Command[] {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const city = content.culiacan.parentNode;
  const committed = Object.values(state.crews).filter((c) => c.colonia !== null && crewNetwork(state, c) === fs.id).length;
  const open = state.requests.some((r) => r.faction === fs.id && r.kind === 'hold_colonia' && (r.status === 'pending' || r.status === 'accepted'));
  if (committed >= s.coloniaCrewsTarget || open) return [];
  const target = contestedColonia(ctx, fs.id);
  if (!target) return [];
  const cooldown = content.tuning.ai.requests.repeatCooldownHours;
  const pool = detachable(ctx, fs.id, freeCrews(ctx, fs.id))
    .filter((c) => c.owner === fs.head || mayAsk(state, fs.head!, c.owner, cooldown))
    .map((c) => ({ c, h: travelHours(state, content, { crews: groupOf(state, c), from: c.location, preference: 'fastest', departHour: state.hour, viewer: fs.id, noPassThrough: rivalPlazaIds(state, fs.id) }).get(city) ?? Infinity }))
    .filter((x) => x.h <= s.maxParticipantHours)
    .sort((a, b) => a.h - b.h || (a.c.id < b.c.id ? -1 : 1));
  const pick = pool[0];
  if (!pick) return [];
  const head = fs.head!;
  if (pick.c.owner === head) {
    return [{ type: 'order_crew', issuer: head, crew: pick.c.id, order: { type: 'move', destination: city, preference: 'fastest', avoidRivalPlazas: true } }];
  }
  createRequest(ctx, { faction: fs.id, from: head, to: pick.c.owner, kind: 'hold_colonia', target, crews: [pick.c.id], arriveBy: state.hour + Math.ceil(pick.h) + s.responseHours + s.slackHours });
  return [];
}

/** The colonia most worth fighting for: contested ones nearest the balance point first. */
export function contestedColonia(ctx: SimContext, faction: NetworkId): Id | null {
  const { state, content } = ctx;
  const sign = faction === content.culiacan.positiveFaction ? 1 : -1;
  const flip = content.tuning.map.coloniaFlipThreshold;
  const ranked = content.culiacan.colonias
    .map((c) => ({ id: c.id, control: state.colonias[c.id]!.control * sign, biz: c.businesses }))
    .filter((c) => c.control < flip)
    .sort((a, b) => b.control - a.control || b.biz - a.biz || (a.id < b.id ? -1 : 1));
  return ranked[0]?.id ?? null;
}

/** A head short of money asks the richest lieutenant for a levy, at most weekly. */
function levy(ctx: SimContext, fs: FactionState): Command[] {
  const { state, content } = ctx;
  const s = content.tuning.ai.strategic;
  const head = fs.head!;
  if (cashOf(state, head) >= s.levyCashWeeks * weeklyObligations(state, content, head)) return [];
  if (state.requests.some((r) => r.from === head && r.kind === 'levy' && state.hour - r.createdAt < 7 * 24)) return [];
  const rich = Object.values(state.characters)
    .filter((c) => c.faction === fs.id && c.id !== head && c.status === 'free')
    .map((c) => ({ id: c.id, cash: cashOf(state, c.id), bills: weeklyObligations(state, content, c.id) }))
    .filter((c) => c.cash > s.levyRichWeeks * Math.max(1, c.bills))
    .sort((a, b) => b.cash - a.cash || (a.id < b.id ? -1 : 1))[0];
  if (rich) createRequest(ctx, { faction: fs.id, from: head, to: rich.id, kind: 'levy', amount: Math.floor(rich.cash * s.levyShare) });
  return [];
}

/** A head with money to spare bails out lieutenants who cannot make payroll (GDD "request cash from their faction head"). */
function supportBroke(ctx: SimContext, fs: FactionState): void {
  const { state, content } = ctx;
  const head = fs.head!;
  const aid = content.tuning.economy.aid;
  for (const c of Object.values(state.characters).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.faction !== fs.id || c.id === head || c.status === 'dead') continue;
    const due = weeklyObligations(state, content, c.id);
    if (c.missedPayrollWeeks === 0 && cashOf(state, c.id) >= due) continue;
    if (c.lastAidAt !== null && state.hour - c.lastAidAt < aid.cooldownDays * 24) continue;
    const spare = cashOf(state, head) - content.tuning.ai.strategic.levyCashWeeks * weeklyObligations(state, content, head);
    const amount = Math.floor(Math.min(aid.maxCash, spare * aid.headCashShare, due * 2));
    if (amount <= 0 || !spend(state, content, head, amount, 'aid')) continue;
    deposit(state, content, c.id, amount, 'aid');
    c.lastAidAt = state.hour;
    if (c.id === state.playerId) pushFeed(state, 'important', `${charName(ctx, head)} sends you $${amount.toLocaleString()} to cover your men.`, null, fs.id);
  }
}
