/**
 * Starts the fights movement found, lets garrisons attack intruders they have
 * spotted, runs Culiacán's urban fighting, and resolves every battle one hour
 * at a time. Also resupplies ammo and restores morale at friendly plazas.
 * GDD: "Combat".
 */
import { pushFeed, newId, type Engagement, type SimContext } from '../context';
import { groupOf, kmFromRoadStart, sameLocation, sortedCrewIds } from '../crews';
import { crewNetwork, networkOf, ownedBy } from '../network';
import { charName, leaderName, notifyOwner, sendToRetreat } from '../orders';
import { spendUpTo } from '../money';
import { crewPower, groupPower, leaderModifier, reportedPower, wantsToAttack } from '../power';
import { chance, randRange } from '../rng';
import { planRoute, travelHours } from '../routing';
import type { Battle, BattleSide, CrewOrder, CrewState, Id, NetworkId } from '../state';
import { world } from '../world';
import { captureCharacter, killCharacter } from './characters';
import { addOpinion } from '../opinion';
import { mutualDefenseCalls, peaceBetween, settleDefenseCalls, truceBetween } from '../pacts';
import { opForCapture } from '../operations';

type SideKey = 'attackers' | 'defenders';
const SIDES: SideKey[] = ['attackers', 'defenders'];
const other = (k: SideKey): SideKey => (k === 'attackers' ? 'defenders' : 'attackers');

export function runCombat(ctx: SimContext): void {
  resupplyAndRecover(ctx);
  for (const e of ctx.engagements) startBattle(ctx, e);
  ctx.engagements = [];
  garrisonsAttack(ctx);
  urbanFighting(ctx);
  for (const id of Object.keys(ctx.state.battles).sort()) {
    const b = ctx.state.battles[id]!;
    if (b.endedAt !== null) continue;
    joinArrivals(ctx, b);
    resolveHour(ctx, b);
  }
  const keep = ctx.content.tuning.combat.battleRetentionHours;
  for (const [id, b] of Object.entries(ctx.state.battles)) {
    if (b.endedAt !== null && ctx.state.hour - b.endedAt > keep) delete ctx.state.battles[id];
  }
}

// ---------------------------------------------------------------------------
// Starting battles
// ---------------------------------------------------------------------------

function crews(ctx: SimContext, ids: readonly Id[]): CrewState[] {
  return ids.map((id) => ctx.state.crews[id]).filter((c): c is CrewState => !!c && c.men > 0);
}

function placeName(ctx: SimContext, b: Pick<Battle, 'where' | 'colonia'>): string {
  const w = world(ctx.content);
  if (b.colonia) return ctx.content.culiacan.colonias.find((c) => c.id === b.colonia)?.name ?? b.colonia;
  if (b.where.kind === 'node') return w.node(b.where.node).name;
  const r = w.road(b.where.road);
  return `the ${r.type} ${w.node(r.from).name}–${w.node(r.to).name}`;
}

const TYPE_LABEL: Record<Battle['type'], string> = {
  ambush: 'Ambush',
  road_clash: 'Clash',
  raid: 'Fighting',
  siege: 'Siege',
  urban_skirmish: 'Street fighting',
  military_clash: 'Clash with the army',
};

export function startBattle(ctx: SimContext, e: Engagement, colonia: Id | null = null): Battle | null {
  const { state, content } = ctx;
  const att = crews(ctx, e.attackers).filter((c) => c.battle === null);
  const def = crews(ctx, e.defenders).filter((c) => c.battle === null);
  if (!att.length) return null;
  const w = world(content);
  const node = e.where.kind === 'node' ? e.where.node : null;
  // A local truce holds: the sides do not fight in that region.
  const truceRegion = w.node(node ?? (e.where.kind === 'road' ? e.where.from : '')).region;
  const holder = node ? state.nodes[node]?.owner : null;
  const defNet = def.length ? crewNetwork(state, def[0]!) : holder ? networkOf(state, holder) : null;
  if (defNet && truceBetween(state, crewNetwork(state, att[0]!), defNet, truceRegion)) return null;
  // Pacts between the bosses involved (non-aggression, safe passage, a truce between two bosses).
  const defOwners = [...new Set([...def.map((c) => c.owner), ...(holder && e.capture ? [holder] : [])])];
  if (peaceBetween(state, [...new Set(att.map((c) => c.owner))], defOwners, truceRegion, e.capture)) return null;
  if (!def.length) {
    if (e.capture && node) {
      capturePlaza(ctx, node, att);
      for (const c of att) c.order = { type: 'garrison' };
    }
    return null;
  }
  const region = w.node(node ?? (e.where.kind === 'road' ? e.where.from : '')).region;
  const side = (list: CrewState[]): BattleSide => ({
    network: crewNetwork(state, list[0]!),
    crews: list.map((c) => c.id),
    owners: [...new Set(list.map((c) => c.owner))].sort(),
    casualties: 0,
    power: 0,
    helpCalled: false,
    ownerMen: list.reduce<Record<Id, number>>((m, c) => ((m[c.owner] = (m[c.owner] ?? 0) + c.men), m), {}),
    ownerLosses: {},
  });
  const battle: Battle = {
    id: newId(state, 'battle'),
    type: e.type,
    where: structuredClone(e.where),
    colonia,
    region,
    startedAt: state.hour,
    hours: 0,
    attackers: side(att),
    defenders: side(def),
    fortification: node && !colonia ? state.nodes[node]!.fortification : 0,
    siegeProgress: 0,
    capture: e.capture,
    withdrawing: [],
    armorPush: [],
    prompted: [],
    log: [],
    endedAt: null,
    winner: null,
  };
  state.battles[battle.id] = battle;
  for (const c of [...att, ...def]) c.battle = battle.id;

  const where = placeName(ctx, battle);
  const attOwner = charName(ctx, att[0]!.owner);
  const defOwner = charName(ctx, def[0]!.owner);
  const menA = att.reduce((n, c) => n + c.men, 0);
  const menD = def.reduce((n, c) => n + c.men, 0);
  battle.log.push(`${TYPE_LABEL[battle.type]} at ${where}: ${attOwner}'s ${menA} men against ${defOwner}'s ${menD}.`);
  const text = `${TYPE_LABEL[battle.type]} at ${where}: ${attOwner}'s people (${menA}) against ${defOwner}'s (${menD}).`;
  const focus = node ?? (e.where.kind === 'road' ? e.where.to : null);
  for (const k of SIDES) pushFeed(state, 'critical', text, focus, battle[k].network, battle.id);
  pushFeed(state, 'routine', `Shooting reported at ${where}.`, focus, null, battle.id);

  // AI sides that are outgunned ask their faction for help at once.
  for (const k of SIDES) {
    const mine = crews(ctx, battle[k].crews);
    if (!state.autoplay && mine.some((c) => c.owner === state.playerId)) continue;
    if (groupPower(state, content, mine) < groupPower(state, content, crews(ctx, battle[other(k)].crews))) callForHelp(ctx, battle, k);
  }
  // Mutual defense partners of the plaza's owner are called; AI partners send their nearest crew.
  mutualDefenseCalls(ctx, battle, (partner) => answerDefenseCall(ctx, battle, partner));
  return battle;
}

/** A mutual defense partner's crews that could reach the battle; AI partners send the nearest. Returns whether any could come. */
function answerDefenseCall(ctx: SimContext, b: Battle, partner: Id): boolean {
  const { state, content } = ctx;
  const options = sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter((c) => c.owner === partner && c.battle === null && c.location.kind === 'node' && (c.order.type === 'garrison' || c.order.type === 'idle'))
    .map((c) => ({ c, order: reinforceOrder(ctx, c, b, content.tuning.combat.reinforceMaxHours) }))
    .filter((x) => x.order !== null);
  if (!options.length) return false;
  if (partner !== state.playerId || state.autoplay) {
    const pick = options.sort((x, y) => x.order!.path.length - y.order!.path.length || (x.c.id < y.c.id ? -1 : 1))[0]!;
    pick.c.order = pick.order!;
  }
  return true;
}

/** A node's owners attack hostile crews they spotted in their own plaza this hour. */
function garrisonsAttack(ctx: SimContext): void {
  const { state, content } = ctx;
  const leaders = sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter((c) => c.location.kind === 'node' && c.battle === null && c.order.type !== 'escort' && c.order.type !== 'lie_low');
  const byNode = new Map<Id, CrewState[]>();
  for (const c of leaders) {
    const n = (c.location as { node: Id }).node;
    byNode.set(n, [...(byNode.get(n) ?? []), c]);
  }
  for (const [node, here] of [...byNode].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const owner = state.nodes[node]?.owner;
    if (!owner || node === content.culiacan.parentNode) continue;
    const net = networkOf(state, owner);
    const garrison = here.filter((c) => crewNetwork(state, c) === net && c.battle === null);
    if (!garrison.length) continue;
    const spotted = here.filter(
      (c) => crewNetwork(state, c) !== net && c.battle === null && state.reports.some((r) => r.network === net && r.crew === c.id && r.hour === state.hour),
    );
    if (!spotted.length) continue;
    const def = garrison.flatMap((c) => groupOf(state, c));
    const intruders = spotted.flatMap((c) => groupOf(state, c));
    if (!wantsToAttack(state, content, def, reportedPower(state, content, net, intruders))) continue;
    startBattle(ctx, { type: 'raid', attackers: intruders.map((c) => c.id), defenders: def.map((c) => c.id), where: { kind: 'node', node }, capture: false });
  }
}

// ---------------------------------------------------------------------------
// Culiacán
// ---------------------------------------------------------------------------

function urbanFighting(ctx: SimContext): void {
  const { state, content } = ctx;
  const { parentNode, positiveFaction, colonias } = content.culiacan;
  const negativeFaction = content.factions.find((f) => f.kind === 'major' && f.id !== positiveFaction)!.id;
  const inCity = sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter((c) => c.location.kind === 'node' && c.location.node === parentNode && c.colonia !== null && c.order.type !== 'escort');
  for (const col of colonias) {
    if (Object.values(state.battles).some((b) => b.colonia === col.id && b.endedAt === null)) continue;
    const here = inCity.filter((c) => c.colonia === col.id && c.battle === null && c.order.type !== 'lie_low');
    const pos = here.filter((c) => crewNetwork(state, c) === positiveFaction);
    const neg = here.filter((c) => crewNetwork(state, c) === negativeFaction);
    const cs = state.colonias[col.id]!;
    if (pos.length && neg.length) {
      // Whoever is pushing into the other side's ground attacks.
      const [attackers, defenders] = cs.control >= 0 ? [neg, pos] : [pos, neg];
      startBattle(
        ctx,
        { type: 'urban_skirmish', attackers: attackers.map((c) => c.id), defenders: defenders.map((c) => c.id), where: { kind: 'node', node: parentNode }, capture: false },
        col.id,
      );
    } else if (pos.length || neg.length) {
      shiftControl(ctx, col.id, (pos.length ? 1 : -1) * content.tuning.combat.urban.uncontestedShiftPerHour);
    }
  }
}

function shiftControl(ctx: SimContext, colonia: Id, delta: number): void {
  const { state, content } = ctx;
  const cs = state.colonias[colonia]!;
  const flip = content.tuning.map.coloniaFlipThreshold;
  const before = cs.control;
  cs.control = Math.max(-100, Math.min(100, cs.control + delta));
  const side = (v: number) => (v >= flip ? 1 : v <= -flip ? -1 : 0);
  if (side(before) !== side(cs.control)) {
    const name = content.culiacan.colonias.find((c) => c.id === colonia)!.name;
    const pos = content.culiacan.positiveFaction;
    const holder = side(cs.control) === 0 ? null : side(cs.control) > 0 ? pos : content.factions.find((f) => f.kind === 'major' && f.id !== pos)!.id;
    const holderName = holder ? content.factions.find((f) => f.id === holder)!.name : null;
    pushFeed(state, 'important', holderName ? `${name} is now held by the ${holderName}.` : `${name} is contested again.`, content.culiacan.parentNode, null);
  }
}

// ---------------------------------------------------------------------------
// Each hour of battle
// ---------------------------------------------------------------------------

function atBattle(ctx: SimContext, b: Battle, c: CrewState): boolean {
  if (b.colonia) return c.location.kind === 'node' && c.location.node === (b.where as { node: Id }).node && c.colonia === b.colonia;
  if (b.where.kind === 'node') return c.location.kind === 'node' && c.location.node === b.where.node && c.colonia === null;
  if (c.location.kind !== 'road' || c.location.road !== b.where.road) return false;
  return Math.abs(kmFromRoadStart(ctx.content, c.location) - kmFromRoadStart(ctx.content, b.where)) < 0.5;
}

/** Friendly crews that reached the fighting join at the start of the hour. */
function joinArrivals(ctx: SimContext, b: Battle): void {
  const { state } = ctx;
  for (const id of sortedCrewIds(state)) {
    const c = state.crews[id]!;
    if (c.battle !== null || c.order.type === 'escort' || c.order.type === 'lie_low' || !atBattle(ctx, b, c)) continue;
    const net = crewNetwork(state, c);
    const k = SIDES.find((s) => b[s].network === net);
    if (!k) continue;
    for (const g of groupOf(state, c)) {
      g.battle = b.id;
      b[k].crews.push(g.id);
      if (!b[k].owners.includes(g.owner)) b[k].owners.push(g.owner);
      b[k].ownerMen[g.owner] = (b[k].ownerMen[g.owner] ?? 0) + g.men;
    }
    b.log.push(`H${b.hours + 1}: ${leaderName(ctx, c)}'s crew (${c.men}) joins the ${k}.`);
    notifyOwner(ctx, c, 'important', `${leaderName(ctx, c)}'s crew joined the fight at ${placeName(ctx, b)}.`, null, b.id);
  }
}

function terrainOf(ctx: SimContext, b: Battle): number {
  const { content } = ctx;
  const t = content.tuning.combat;
  const w = world(content);
  const terrain = b.where.kind === 'road' ? w.road(b.where.road).terrain : t.nodeTerrain[w.node(b.where.node).type];
  return t.terrain[terrain] ?? 1;
}

interface TypeScale {
  casualty: number;
  ammo: number;
  morale: number;
}

function typeScale(ctx: SimContext, b: Battle): TypeScale {
  const t = ctx.content.tuning.combat;
  if (b.type === 'siege') return { casualty: t.siege.casualtyMultiplier, ammo: t.siege.ammoMultiplier, morale: t.siege.moraleMultiplier };
  if (b.type === 'urban_skirmish') return { casualty: t.urban.casualtyMultiplier, ammo: t.urban.ammoMultiplier, morale: t.urban.moraleMultiplier };
  return { casualty: 1, ammo: 1, morale: 1 };
}

export function sidePower(ctx: SimContext, b: Battle, k: SideKey): number {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  let p = 0;
  for (const c of crews(ctx, b[k].crews)) {
    let cp = crewPower(state, content, c, b.armorPush.includes(c.id) ? t.armorPushPowerMultiplier : 1);
    if (k === 'attackers' && b.type === 'ambush') cp *= leaderModifier(state, content, c, 'ambushPower');
    if (k === 'attackers' && b.type === 'siege') cp *= leaderModifier(state, content, c, 'siegePower');
    p += cp;
  }
  if (k === 'attackers' && b.type === 'ambush' && b.hours === 0) p *= t.ambushFirstHourMultiplier;
  if (k === 'defenders') p *= 1 + t.fortificationBonusPerLevel * b.fortification * (1 - b.siegeProgress / 100);
  // Terrain favors whoever chose the ground: ambushers, otherwise defenders.
  if ((b.type === 'ambush') === (k === 'attackers')) p *= terrainOf(ctx, b);
  return p;
}

function resolveHour(ctx: SimContext, b: Battle): void {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  if (!crews(ctx, b.attackers.crews).length || !crews(ctx, b.defenders.crews).length) {
    endBattle(ctx, b);
    return;
  }
  const scale = typeScale(ctx, b);
  const power = { attackers: sidePower(ctx, b, 'attackers'), defenders: sidePower(ctx, b, 'defenders') };
  b.attackers.power = power.attackers;
  b.defenders.power = power.defenders;
  const roll = { attackers: randRange(state.rng, t.randomFactorMin, t.randomFactorMax), defenders: randRange(state.rng, t.randomFactorMin, t.randomFactorMax) };
  const lost = { attackers: 0, defenders: 0 };
  for (const k of SIDES) {
    const inflicted = power[other(k)] * t.casualtyRatePerHour * scale.casualty * roll[other(k)];
    lost[k] = applyLosses(ctx, b, k, inflicted, scale);
    b[k].casualties += lost[k];
  }
  b.hours += 1;

  // Ammo, siege progress, Culiacán control.
  for (const k of SIDES) {
    for (const c of crews(ctx, b[k].crews)) {
      c.ammo = Math.max(0, c.ammo - (100 / content.tuning.crews.ammoHoursOfFighting) * scale.ammo);
      if (b.type === 'siege' && k === 'defenders') c.ammo = Math.min(100, c.ammo + t.siege.defenderResupplyPerHour);
    }
  }
  if (b.type === 'siege') {
    b.siegeProgress = Math.min(100, b.siegeProgress + t.siege.progressPerHourAtParity * (power.attackers / Math.max(1, power.defenders)));
  }
  if (b.colonia) {
    const posKey = SIDES.find((k) => b[k].network === content.culiacan.positiveFaction);
    if (posKey) {
      const pp = power[posKey];
      const pn = power[other(posKey)];
      shiftControl(ctx, b.colonia, t.urban.controlShiftPerHour * ((pp - pn) / Math.max(1, pp + pn)));
    }
  }

  // The wider war feels every hour of fighting.
  if (b.where.kind === 'node') {
    const plaza = state.nodes[b.where.node];
    if (plaza) plaza.combatHoursToday += 1;
  }
  const region = state.regions[b.region];
  if (region) {
    region.combatHoursToday += 1;
    region.calentura = Math.min(100, region.calentura + t.calenturaPerCombatHour + (lost.attackers + lost.defenders) * t.calenturaPerCasualty);
  }
  for (const k of SIDES) {
    const f = state.factions[b[k].network];
    if (!f) continue;
    f.combatHoursToday += 1;
    f.supply = Math.max(0, f.supply - t.supplyPerCombatHour);
    f.exhaustion = Math.min(100, f.exhaustion + lost[k] * t.exhaustionPerCasualty + t.exhaustionPerCombatHour);
  }
  b.log.push(
    `H${b.hours}: ${Math.round(power.attackers)} vs ${Math.round(power.defenders)} power; attackers lost ${lost.attackers}, defenders lost ${lost.defenders}` +
      (b.type === 'siege' ? `; siege ${Math.round(b.siegeProgress)}%` : '') +
      '.',
  );
  if (b.log.length > 60) b.log.splice(0, b.log.length - 60);

  for (const k of SIDES) checkCrews(ctx, b, k);
  promptPlayer(ctx, b);
  b.withdrawing = [];
  b.armorPush = [];
  if (!crews(ctx, b.attackers.crews).length || !crews(ctx, b.defenders.crews).length) endBattle(ctx, b);
}

/** Armored trucks soak up the first losses; the rest spread by crew size. Returns men lost. */
function applyLosses(ctx: SimContext, b: Battle, k: SideKey, inflicted: number, scale: TypeScale): number {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  let remaining = inflicted;
  const list = crews(ctx, b[k].crews);
  for (const c of list) {
    if (remaining <= 0 || c.vehicles.armored <= 0) continue;
    const absorbed = Math.min(remaining, c.vehicles.armored * t.armoredAbsorbPerTruck);
    remaining -= absorbed;
    c.armorDamage += absorbed * t.armoredDamagePerAbsorbed * (b.armorPush.includes(c.id) ? t.armorPushDamageMultiplier : 1);
    while (c.armorDamage >= 100 && c.vehicles.armored > 0) {
      c.vehicles.armored -= 1;
      c.armorDamage -= 100;
      b.log.push(`H${b.hours + 1}: ${leaderName(ctx, c)}'s crew lost an armored truck.`);
      notifyOwner(ctx, c, 'critical', `${leaderName(ctx, c)}'s crew lost an armored truck at ${placeName(ctx, b)}.`, null, b.id);
    }
    if (c.vehicles.armored === 0) c.armorDamage = 0;
  }
  const weight = (c: CrewState) => c.men * (b.withdrawing.includes(c.id) ? t.withdrawLossMultiplier : 1);
  const total = list.reduce((n, c) => n + weight(c), 0);
  let men = 0;
  for (const c of list) {
    if (total <= 0) break;
    const share = (remaining * weight(c)) / total;
    const whole = Math.floor(share);
    const loss = Math.min(c.men, whole + (chance(state.rng, share - whole) ? 1 : 0));
    const before = c.men;
    c.men -= loss;
    men += loss;
    // A crew that changed hands mid-fight (its owner died) counts for its new owner.
    if (b[k].ownerMen[c.owner] === undefined) b[k].ownerMen[c.owner] = before;
    if (loss > 0) b[k].ownerLosses[c.owner] = (b[k].ownerLosses[c.owner] ?? 0) + loss;
    const moraleMult = leaderModifier(state, content, c, 'crewMoraleLossMultiplier');
    c.morale = Math.max(0, c.morale - ((loss / before) * 100 * t.moraleLossPerPctLost + t.moraleLossPerHour) * scale.morale * moraleMult);
    if (loss > 0 && state.characters[c.leader]?.status === 'free') {
      const risk = (loss / before) * t.leaderRiskPerLossFraction * leaderModifier(state, content, c, 'leaderDeathRisk');
      if (chance(state.rng, risk)) loseLeader(ctx, b, c, 'killed', null);
    }
  }
  return men;
}

/** A crew's leader falls. Morale shatters and the owner (if free) takes over. */
function loseLeader(ctx: SimContext, b: Battle, c: CrewState, how: 'killed' | 'captured', captor: Id | null): void {
  const { state, content } = ctx;
  const leader = c.leader;
  b.log.push(`H${b.hours + 1}: ${leaderName(ctx, c)} was ${how}.`);
  if (how === 'killed') killCharacter(ctx, leader);
  else if (captor) captureCharacter(ctx, leader, captor);
  c.morale = Math.max(0, c.morale - content.tuning.combat.leaderLossMorale);
  if (state.crews[c.id] && state.characters[c.owner]?.status === 'free') c.leader = c.owner;
}

/** Retreat, rout, destruction, ammo, and orderly withdrawal. */
function checkCrews(ctx: SimContext, b: Battle, k: SideKey): void {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  const enemyOwner = crews(ctx, b[other(k)].crews)[0]?.owner ?? null;
  for (const id of [...b[k].crews]) {
    const c = state.crews[id];
    if (!c) {
      b[k].crews = b[k].crews.filter((x) => x !== id);
      continue;
    }
    const name = leaderName(ctx, c);
    if (c.men <= 0) {
      b.log.push(`H${b.hours}: ${name}'s crew was wiped out.`);
      notifyOwner(ctx, c, 'critical', `${name}'s crew was wiped out at ${placeName(ctx, b)}.`, null, b.id);
      if (state.characters[c.leader]?.status === 'free') {
        const killed = !enemyOwner || chance(state.rng, t.leaderDeathChanceOnDestroyed);
        loseLeader(ctx, b, c, killed ? 'killed' : 'captured', enemyOwner);
      }
      removeCrew(ctx, b, k, c);
      continue;
    }
    const retreatAt = t.retreatMorale + traitOffset(ctx, c);
    if (b.withdrawing.includes(c.id)) {
      b.log.push(`H${b.hours}: ${name}'s crew withdrew in good order.`);
      leave(ctx, b, k, c);
    } else if (c.morale < t.routMorale) {
      const captured = Math.round(c.men * t.routCaptureShare);
      const scattered = Math.round(c.men * t.routScatterShare);
      c.men = Math.max(0, c.men - captured - scattered);
      b.log.push(`H${b.hours}: ${name}'s crew routed (${captured} captured, ${scattered} scattered).`);
      notifyOwner(ctx, c, 'critical', `${name}'s crew broke and ran at ${placeName(ctx, b)}.`, null, b.id);
      if (enemyOwner && state.characters[c.leader]?.status === 'free' && chance(state.rng, t.leaderCaptureChanceOnRout)) loseLeader(ctx, b, c, 'captured', enemyOwner);
      if (c.men <= 0) removeCrew(ctx, b, k, c);
      else leave(ctx, b, k, c);
    } else if (c.morale < retreatAt) {
      b.log.push(`H${b.hours}: ${name}'s crew fell back.`);
      leave(ctx, b, k, c);
    } else if (c.ammo <= 0) {
      b.log.push(`H${b.hours}: ${name}'s crew ran out of ammunition and pulled out.`);
      leave(ctx, b, k, c);
    }
  }
}

/** Valiente crews hold longer, Cobarde crews break sooner (trait "retreatMoraleOffset"). */
function traitOffset(ctx: SimContext, c: CrewState): number {
  let off = 0;
  for (const tr of ctx.state.characters[c.leader]?.traits ?? []) off += ctx.content.traits.find((x) => x.id === tr)?.modifiers.retreatMoraleOffset ?? 0;
  return off;
}

function detach(ctx: SimContext, b: Battle, k: SideKey, c: CrewState): CrewState[] {
  const group = [c, ...crews(ctx, b[k].crews).filter((e) => e.order.type === 'escort' && e.order.crew === c.id)];
  for (const g of group) {
    g.battle = null;
    b[k].crews = b[k].crews.filter((x) => x !== g.id);
  }
  return group;
}

/** A crew leaves the fight and falls back. */
function leave(ctx: SimContext, b: Battle, k: SideKey, c: CrewState): void {
  detach(ctx, b, k, c);
  if (b.colonia) {
    c.colonia = null;
    c.order = { type: 'idle' };
  } else {
    sendToRetreat(ctx, c, true);
  }
}

function removeCrew(ctx: SimContext, b: Battle, k: SideKey, c: CrewState): void {
  detach(ctx, b, k, c);
  for (const e of Object.values(ctx.state.crews)) if (e.order.type === 'escort' && e.order.crew === c.id) e.order = { type: 'idle' };
  delete ctx.state.crews[c.id];
}

function avgMorale(list: CrewState[]): number {
  const men = list.reduce((n, c) => n + c.men, 0);
  return men ? list.reduce((n, c) => n + c.morale * c.men, 0) / men : 100;
}

/** Pause the player on the key moments of a battle their network is in. */
function promptPlayer(ctx: SimContext, b: Battle): void {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  const net = networkOf(state, state.playerId);
  const k = SIDES.find((s) => b[s].network === net);
  if (!k) return;
  const mine = crews(ctx, b[k].crews);
  const theirs = crews(ctx, b[other(k)].crews);
  if (!mine.length || !theirs.length) return;
  const where = placeName(ctx, b);
  if (!b.prompted.includes('enemy_wavering') && avgMorale(theirs) < t.surrenderMorale && mine.some((c) => c.owner === state.playerId)) {
    b.prompted.push('enemy_wavering');
    pushFeed(state, 'critical', `The enemy at ${where} is wavering. You can accept their surrender.`, null, net, b.id);
  }
  if (!b.prompted.includes('own_wavering') && avgMorale(mine) < t.waveringMorale) {
    b.prompted.push('own_wavering');
    pushFeed(state, 'critical', `Your men at ${where} are wavering. Commit reserves or withdraw?`, null, net, b.id);
  }
}

// ---------------------------------------------------------------------------
// Ending battles
// ---------------------------------------------------------------------------

function endBattle(ctx: SimContext, b: Battle, forcedWinner: SideKey | null = null): void {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  const alive = { attackers: crews(ctx, b.attackers.crews), defenders: crews(ctx, b.defenders.crews) };
  const winner: SideKey | null = forcedWinner ?? (alive.attackers.length ? 'attackers' : alive.defenders.length ? 'defenders' : null);
  b.endedAt = state.hour;
  b.winner = winner;
  const where = placeName(ctx, b);
  if (winner) {
    for (const c of alive[winner]) {
      c.battles += 1;
      if (c.battles % t.skillUpEveryBattles === 0 && c.skill < 5) c.skill += 1;
    }
    for (const id of b[winner].owners) {
      const ch = state.characters[id];
      if (ch) ch.respect += t.respectPerVictory;
    }
    for (const id of b[other(winner)].owners) {
      const ch = state.characters[id];
      if (ch) ch.respect -= t.respectPerVictory;
    }
  }
  for (const k of SIDES) {
    for (const c of alive[k]) {
      c.battle = null;
      if (k === winner) resumeAfterWin(ctx, b, c);
      else leave(ctx, b, k, c);
    }
  }
  const node = b.where.kind === 'node' && !b.colonia ? b.where.node : null;
  if (b.where.kind === 'node') state.nodes[b.where.node]!.lastBattleAt = state.hour;
  settleDefenseCalls(ctx, b);
  if (winner === 'attackers' && b.capture && node) {
    const net = b.attackers.network;
    const holdouts = Object.values(state.crews).some(
      (c) =>
        c.location.kind === 'node' &&
        c.location.node === node &&
        crewNetwork(state, c) !== net &&
        c.order.type !== 'lie_low' &&
        c.order.type !== 'retreat',
    );
    if (!holdouts) {
      const plaza = state.nodes[node]!;
      if (b.type === 'siege') plaza.fortification = Math.max(0, plaza.fortification - t.siege.fortificationLossOnFall);
      capturePlaza(ctx, node, alive.attackers, b);
    }
  }
  const text = winner
    ? `${TYPE_LABEL[b.type]} at ${where} is over after ${b.hours}h: the ${winner} won. Losses: ${b.attackers.casualties} attackers, ${b.defenders.casualties} defenders.`
    : `${TYPE_LABEL[b.type]} at ${where} is over.`;
  b.log.push(text);
  for (const k of SIDES) pushFeed(state, 'important', text, node, b[k].network, b.id);
}

/** Winners carry on: movers resume their route, raiders garrison what they took. */
function resumeAfterWin(ctx: SimContext, b: Battle, c: CrewState): void {
  const { state } = ctx;
  const o = c.order;
  if (o.type === 'raid' || o.type === 'reinforce') {
    const here = c.location.kind === 'node' ? c.location.node : null;
    c.order = here && ownedBy(state, here, crewNetwork(state, c)) ? { type: 'garrison' } : { type: 'idle' };
  }
}

/** The attackers take the plaza: new owner, fresh halcones, seized stash. */
/**
 * Who takes a captured plaza. A joint operation's agreed rule comes first;
 * otherwise the highest contribution: each man who fought counts 1 and each
 * man lost counts 2 (blood outweighs headcount). Ties go to the operation's
 * proposer, then to the bigger force, then by id.
 */
export function plazaRecipient(ctx: SimContext, node: Id, winners: CrewState[], battle: Battle | null): Id {
  const { state, content } = ctx;
  const net = crewNetwork(state, winners[0]!);
  const score = new Map<Id, number>();
  if (battle) {
    const k = SIDES.find((x) => battle[x].network === net) ?? 'attackers';
    const lossWeight = content.tuning.combat.contributionLossWeight;
    for (const [owner, men] of Object.entries(battle[k].ownerMen)) score.set(owner, men + lossWeight * (battle[k].ownerLosses[owner] ?? 0));
  }
  for (const c of winners) if (!score.has(c.owner)) score.set(c.owner, c.men);
  const op = opForCapture(state, node, net, content.tuning.coalition.earlyHours);
  const agreed = op?.plaza === 'proposer' ? op.proposer : op && op.plaza !== 'contribution' ? op.plaza : null;
  if (agreed && score.has(agreed) && state.characters[agreed]?.status !== 'dead') return agreed;
  const men = (id: Id) => winners.filter((c) => c.owner === id).reduce((n, c) => n + c.men, 0);
  return [...score.keys()]
    .filter((id) => state.characters[id] && state.characters[id]!.status !== 'dead' && state.characters[id]!.status !== 'extradited')
    .sort((a, b) => score.get(b)! - score.get(a)! || Number(b === op?.proposer) - Number(a === op?.proposer) || men(b) - men(a) || (a < b ? -1 : 1))[0] ?? winners[0]!.owner;
}

export function capturePlaza(ctx: SimContext, node: Id, winners: CrewState[], battle: Battle | null = null): void {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  if (!winners.length || node === content.culiacan.parentNode) return;
  const plaza = state.nodes[node]!;
  const lead = { owner: plazaRecipient(ctx, node, winners, battle) };
  const prev = plaza.owner;
  if (prev && networkOf(state, prev) === crewNetwork(state, winners[0]!)) return;
  if (prev) {
    const f = state.factions[networkOf(state, prev)];
    if (f) f.warPlan.lost = [...f.warPlan.lost.filter((l) => l.node !== node && state.hour - l.at < 30 * 24), { node, at: state.hour }];
  }
  plaza.owner = lead.owner;
  // Those who refused to help hold this plaza are remembered by their head.
  if (prev) {
    const keep = content.tuning.ai.requests.keepHours;
    for (const r of state.requests) {
      if (r.kind !== 'defend' || r.target !== node || (r.status !== 'declined' && r.status !== 'expired') || state.hour - (r.resolvedAt ?? 0) > keep) continue;
      addOpinion(state, content, r.from, r.to, 'left_us_exposed', content.tuning.ai.requests.leftExposedOpinion, content.tuning.ai.requests.opinionDecayDays);
    }
  }
  plaza.halconCoverage = t.capturedPlazaHalcones;
  plaza.support = Math.max(0, plaza.support - t.capturedPlazaSupportLoss);
  plaza.claims = [];
  // The stash house stays with the plaza, so its cash now belongs to the new owner.
  for (const c of winners) c.order = { type: 'garrison' };
  const name = world(content).node(node).name;
  pushFeed(state, 'critical', `${charName(ctx, lead.owner)} took ${name}${prev ? ` from ${charName(ctx, prev)}` : ''}.`, node, null);
}

// ---------------------------------------------------------------------------
// Reinforcement and help
// ---------------------------------------------------------------------------

/** A reinforce order that takes a crew to the battle, or null if it cannot get there in time. */
export function reinforceOrder(ctx: SimContext, crew: CrewState, b: Battle, maxHours = Infinity): Extract<CrewOrder, { type: 'reinforce' }> | null {
  const { state, content } = ctx;
  const net = crewNetwork(state, crew);
  const group = groupOf(state, crew);
  const base = { crews: group, from: crew.location, departHour: state.hour, viewer: net, preference: 'fastest' as const };
  if (sameLocation(content, crew.location, b.where)) return { type: 'reinforce', battle: b.id, path: [] };
  const targets = b.where.kind === 'node' ? [b.where.node] : [b.where.from, b.where.to];
  const hours = travelHours(state, content, base);
  let best: Id | null = null;
  for (const n of targets) if ((hours.get(n) ?? Infinity) < (best ? hours.get(best)! : Infinity)) best = n;
  if (!best || hours.get(best)! > maxHours) return null;
  const onRoad = crew.location.kind === 'road' && b.where.kind === 'road' && crew.location.road === b.where.road;
  if (onRoad) return { type: 'reinforce', battle: b.id, path: [] };
  const route = planRoute(state, content, { ...base, destination: best });
  return route ? { type: 'reinforce', battle: b.id, path: route.path } : null;
}

/** Nearby faction crews (not the player's) ride to help one side of a battle. */
export function callForHelp(ctx: SimContext, b: Battle, k: SideKey): number {
  const { state, content } = ctx;
  const t = content.tuning.combat;
  const side = b[k];
  if (side.helpCalled) return 0;
  side.helpCalled = true;
  const candidates = sortedCrewIds(state)
    .map((id) => state.crews[id]!)
    .filter(
      (c) =>
        crewNetwork(state, c) === side.network &&
        (c.owner !== state.playerId || state.autoplay) &&
        c.battle === null &&
        c.colonia === null &&
        (c.order.type === 'garrison' || c.order.type === 'idle') &&
        c.location.kind === 'node',
    );
  const options: { crew: CrewState; order: Extract<CrewOrder, { type: 'reinforce' }>; km: number }[] = [];
  for (const c of candidates) {
    const order = reinforceOrder(ctx, c, b, t.reinforceMaxHours);
    if (!order) continue;
    const km = order.path.reduce((sum, s) => sum + world(content).road(s.road).lengthKm, 0);
    options.push({ crew: c, order, km });
  }
  options.sort((x, y) => x.km - y.km || (x.crew.id < y.crew.id ? -1 : 1));
  const sent = options.slice(0, t.helpCrewsPerCall);
  for (const s of sent) s.crew.order = s.order;
  if (sent.length) {
    const men = sent.reduce((n, s) => n + s.crew.men, 0);
    pushFeed(state, 'important', `Help is coming to ${placeName(ctx, b)}: ${sent.length} crew(s), ${men} men.`, null, side.network, b.id);
  }
  return sent.length;
}

/** A side accepts the enemy's surrender: men and leaders taken, trucks seized. */
export function acceptSurrender(ctx: SimContext, b: Battle, issuer: Id = ctx.state.playerId): string | null {
  const { state, content } = ctx;
  const net = networkOf(state, issuer);
  const k = SIDES.find((s) => b[s].network === net);
  if (!k || b.endedAt !== null) return 'you are not in this battle';
  const mine = crews(ctx, b[k].crews).filter((c) => c.owner === issuer);
  const theirs = crews(ctx, b[other(k)].crews);
  if (!mine.length) return 'none of your crews are in this battle';
  if (avgMorale(theirs) >= content.tuning.combat.surrenderMorale) return 'they are not ready to surrender';
  const taker = [...mine].sort((a, x) => x.men - a.men)[0]!;
  let men = 0;
  for (const c of theirs) {
    men += c.men;
    for (const v of ['pickup', 'suv', 'motorcycle', 'armored'] as const) taker.vehicles[v] += c.vehicles[v];
    if (state.characters[c.leader]?.status === 'free') captureCharacter(ctx, c.leader, issuer);
    b.log.push(`H${b.hours}: ${leaderName(ctx, c)}'s crew surrendered.`);
    removeCrew(ctx, b, other(k), c);
  }
  pushFeed(state, 'critical', `${men} men surrendered at ${placeName(ctx, b)}. Their vehicles are yours.`, null, net, b.id);
  endBattle(ctx, b, k);
  return null;
}

// ---------------------------------------------------------------------------
// Resupply
// ---------------------------------------------------------------------------

/** At a plaza their network holds, crews reload (paid by their owner) and recover morale. */
function resupplyAndRecover(ctx: SimContext): void {
  const { state, content } = ctx;
  const ct = content.tuning.crews;
  const economy = content.tuning.economy;
  const flip = content.tuning.map.coloniaFlipThreshold;
  for (const id of sortedCrewIds(state)) {
    const c = state.crews[id]!;
    if (c.battle !== null || c.location.kind !== 'node') continue;
    const net = crewNetwork(state, c);
    const node = c.location.node;
    let friendly = ownedBy(state, node, net);
    if (node === content.culiacan.parentNode && c.colonia) {
      const control = state.colonias[c.colonia]?.control ?? 0;
      friendly = net === content.culiacan.positiveFaction ? control >= flip : control <= -flip;
    }
    if (!friendly) continue;
    if (c.ammo < 100) {
      const want = Math.min(100 - c.ammo, ct.ammoResupplyPerHour);
      const costPerPct = (economy.ammoResupplyPerMan * c.men) / 100;
      const paid = costPerPct > 0 ? spendUpTo(state, content, c.owner, want * costPerPct, 'ammo') : 0;
      c.ammo += costPerPct > 0 ? paid / costPerPct : want;
    }
    if (c.order.type === 'garrison' || c.order.type === 'idle' || c.order.type === 'lie_low') {
      const d = ct.moraleBaseline - c.morale;
      c.morale += Math.sign(d) * Math.min(Math.abs(d), ct.moraleRecoveryPerHour);
    }
  }
}

export type { SideKey };

export function sideOf(b: Battle, network: NetworkId): SideKey | null {
  return SIDES.find((s) => b[s].network === network) ?? null;
}
