/**
 * Information warfare (GDD "Information warfare"). Messages move morale,
 * fear, respect, and what rivals believe:
 *
 * - narcomantas claim, threaten, or accuse in one plaza;
 * - videos rally your side or threaten a rival statewide;
 * - social media claims move morale, and false ones can be exposed;
 * - corridos build respect and recruitment slowly;
 * - planted rumors feed false intel into a rival network's fog of war (a fake
 *   convoy, a fake weakness) or a fake betrayal into a head's ear;
 * - a show of force parades crews for fear and recruits, and tells everyone
 *   where they are.
 *
 * Every message's effect scales with the sender's credibility, which exposed
 * lies wear down.
 */
import type { MessageTemplate } from '../../data/schemas';
import { newId, pushFeed, type SimContext } from '../context';
import { groupOf } from '../crews';
import { spend } from '../money';
import { crewNetwork, networkOf } from '../network';
import { addOpinion, opinionOf } from '../opinion';
import { charName } from '../orders';
import { chance, rand } from '../rng';
import type { ClaimKind, CrewState, Id, NetworkId, RumorKind } from '../state';
import { majorFactions } from '../ai/util';
import { traitProduct } from '../traits';
import { world } from '../world';
import { report } from './detection';
import { fireById, homeRegion } from './events';

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** Message effects scale with credibility. */
export function reach(ctx: SimContext, id: Id): number {
  return ctx.content.tuning.infowar.credibilityBase + (ctx.state.characters[id]?.credibility ?? 0) / 100;
}

function networkName(ctx: SimContext, net: NetworkId): string {
  return ctx.content.factions.find((f) => f.id === net)?.name ?? charName(ctx, net);
}

/** The best Astucia a network can bring to bear (its head, or the neutral himself). */
function sharpest(ctx: SimContext, net: NetworkId): number {
  const { state } = ctx;
  let best = 0;
  for (const c of Object.values(state.characters)) {
    if (c.status !== 'free' || networkOf(state, c.id) !== net) continue;
    if (c.rank === 'crew_leader' || c.rank === 'associate') continue;
    best = Math.max(best, c.skills.astucia);
  }
  return best;
}

function netHead(ctx: SimContext, net: NetworkId): Id | null {
  return ctx.state.factions[net]?.head ?? (ctx.state.characters[net] ? net : null);
}

/** A message template's text with variables filled in. */
export function renderMessage(
  ctx: SimContext,
  kind: MessageTemplate['kind'],
  tags: string[],
  vars: { sender: Id; target?: Id | null; plaza?: Id | null; road?: Id | null; against?: NetworkId | null },
): string {
  const { state, content } = ctx;
  const w = world(content);
  const pool = content.messages.filter((m) => m.kind === kind && tags.every((t) => m.tags.includes(t)));
  const list = pool.length ? pool : content.messages.filter((m) => m.kind === kind);
  if (!list.length) return '';
  const tpl = list[Math.floor(rand(state.rng) * list.length)]!;
  const sender = state.characters[vars.sender];
  const road = vars.road ? w.road(vars.road) : null;
  const map: Record<string, string> = {
    'sender.name': charName(ctx, vars.sender),
    'target.name': vars.target ? charName(ctx, vars.target) : 'the other side',
    'plaza.name': vars.plaza ? w.node(vars.plaza).name : sender?.homePlaza ? w.node(sender.homePlaza).name : 'the plaza',
    'road.name': road ? `the ${road.type} ${w.node(road.from).name}–${w.node(road.to).name}` : 'the highway',
    'faction.name': networkName(ctx, networkOf(state, vars.sender)),
    'rival_faction.name': vars.against ? networkName(ctx, vars.against) : 'the other side',
    number: String(10 + Math.floor(rand(state.rng) * 190)),
  };
  return tpl.text.replace(/\{([a-z_.]+)\}/g, (m, k: string) => map[k] ?? m);
}

function crewsOfNetwork(ctx: SimContext, net: NetworkId): CrewState[] {
  return Object.keys(ctx.state.crews)
    .sort()
    .map((id) => ctx.state.crews[id]!)
    .filter((c) => crewNetwork(ctx.state, c) === net);
}

// ---------------------------------------------------------------------------
// Rumors
// ---------------------------------------------------------------------------

/**
 * Plants a rumor in a rival network. Fake convoys and fake weaknesses become
 * reports the target cannot tell from real ones; a fake betrayal poisons a
 * head against one of their lieutenants (a Paranoico head may purge him).
 */
export function plantRumor(ctx: SimContext, owner: Id, network: NetworkId, kind: RumorKind, subject: Id | null, free = false, node: Id | null = null): string | null {
  const { state, content } = ctx;
  const r = content.tuning.infowar.rumor;
  const w = world(content);
  const me = state.characters[owner];
  if (!me) return 'unknown character';
  if (network === networkOf(state, owner)) return 'rumors go to rivals';
  const home = node ?? me.homePlaza ?? Object.keys(state.nodes).sort().find((n) => state.nodes[n]!.owner === owner) ?? null;
  if (kind === 'fake_betrayal') {
    const s = subject ? state.characters[subject] : undefined;
    if (!s || s.status !== 'free' || networkOf(state, s.id) !== network || netHead(ctx, network) === s.id) return 'pick a lieutenant on that side';
  } else if (!home) return 'you need a plaza to stage it from';
  if (!free && !spend(state, content, owner, r.cost, 'messages')) return `a rumor costs $${r.cost.toLocaleString()}`;

  const rumor = { id: newId(state, 'rumor'), kind, owner, network, subject: kind === 'fake_betrayal' ? subject : null, reports: [] as Id[], at: state.hour, until: state.hour + r.lastsHours, discovered: false };
  if (kind === 'fake_convoy' || kind === 'fake_weakness') {
    const men = kind === 'fake_convoy' ? r.fakeConvoyMen : r.fakeGarrisonMen;
    const roads = w.neighbors(home!).map((n) => n.road).sort((a, b) => (a.id < b.id ? -1 : 1));
    const road = kind === 'fake_convoy' && roads.length ? roads[Math.floor(rand(state.rng) * roads.length)]! : null;
    const id = newId(state, 'rep');
    state.reports.push({
      id,
      network,
      crew: `ghost_${rumor.id}`,
      owner,
      men,
      vehicles: { pickup: Math.max(1, Math.ceil(men / 4)) },
      where: road ? { kind: 'road', road: road.id, from: road.from === home ? road.from : road.to, to: road.from === home ? road.to : road.from, progressKm: road.lengthKm / 2 } : { kind: 'node', node: home! },
      roadType: road ? road.type : null,
      hour: state.hour,
      confidence: kind === 'fake_weakness' ? 'confirmed' : 'estimated',
      source: kind === 'fake_weakness' ? 'presence' : 'halcon',
      planted: true,
    });
    rumor.reports.push(id);
    const text = renderMessage(ctx, 'rumor', kind === 'fake_convoy' ? ['bait', 'convoy'] : ['bait', 'weakness'], { sender: owner, plaza: home, road: road?.id ?? null });
    pushFeed(state, 'important', `Word on the street: ${text}`, road ? road.to : home, network);
  } else {
    const head = netHead(ctx, network)!;
    addOpinion(state, content, head, subject!, 'rumored_turncoat', r.betrayalOpinion, content.tuning.events.opinionDecayDays);
    const paranoid = state.characters[head]?.traits.includes('paranoico') ?? false;
    if (paranoid || opinionOf(state, content, head, subject!) < r.purgeBelowOpinion) fireById(ctx, 'rumor_betrayal', subject!, head, subject);
  }
  state.rumors.push(rumor);
  return null;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type InfowarCommand =
  | { type: 'narcomanta'; issuer: Id; node: Id; target?: Id | null }
  | { type: 'video'; issuer: Id; tone: 'rally' | 'threat'; target?: NetworkId | null }
  | { type: 'social_claim'; issuer: Id; claim: ClaimKind; against: NetworkId }
  | { type: 'commission_corrido'; issuer: Id }
  | { type: 'plant_rumor'; issuer: Id; network: NetworkId; kind: RumorKind; subject?: Id | null; node?: Id | null }
  | { type: 'show_of_force'; issuer: Id; node: Id };

export function infowarCommand(ctx: SimContext, cmd: InfowarCommand): string | null {
  const { state, content } = ctx;
  const t = content.tuning.infowar;
  const w = world(content);
  const me = state.characters[cmd.issuer]!;
  const net = networkOf(state, cmd.issuer);
  const m = reach(ctx, cmd.issuer);
  const regionOf = (node: Id) => state.regions[w.node(node).region];
  switch (cmd.type) {
    case 'narcomanta': {
      if (!state.nodes[cmd.node]) return `unknown node "${cmd.node}"`;
      const held = state.nodes[cmd.node]!.owner === cmd.issuer;
      const present = Object.values(state.crews).some((c) => c.owner === cmd.issuer && c.location.kind === 'node' && c.location.node === cmd.node);
      if (!held && !present) return 'you need the plaza or people in it to hang a banner';
      const target = cmd.target ?? null;
      if (target && (!state.characters[target] || networkOf(state, target) === net)) return 'the banner must name a rival';
      if (!spend(state, content, cmd.issuer, t.narcomanta.cost, 'messages')) return `a banner costs $${t.narcomanta.cost.toLocaleString()}`;
      me.fear = clamp(me.fear + t.narcomanta.fear * m * traitProduct(state, content, me.id, 'fearGain'));
      const r = regionOf(cmd.node);
      if (r) r.calentura = clamp(r.calentura + t.narcomanta.calentura * traitProduct(state, content, me.id, 'calenturaMultiplier'));
      if (held && !target) state.nodes[cmd.node]!.support = clamp(state.nodes[cmd.node]!.support + t.narcomanta.support * m);
      if (target) addOpinion(state, content, target, cmd.issuer, 'named_on_a_banner', t.narcomanta.rivalOpinion, content.tuning.events.opinionDecayDays);
      const text = renderMessage(ctx, 'narcomanta', target ? ['accuse'] : held ? ['claim'] : ['warn'], { sender: cmd.issuer, target, plaza: cmd.node, against: target ? networkOf(state, target) : null });
      pushFeed(state, 'routine', `A banner in ${w.node(cmd.node).name}: “${text}”`, cmd.node, null);
      return null;
    }
    case 'video': {
      if (me.lastVideoAt !== null && state.hour - me.lastVideoAt < t.video.cooldownDays * 24) return 'another video so soon would look desperate';
      const target = cmd.tone === 'threat' ? (cmd.target ?? null) : null;
      if (cmd.tone === 'threat' && (!target || target === net)) return 'a threat needs a rival to name';
      if (!spend(state, content, cmd.issuer, t.video.cost, 'messages')) return `a video costs $${t.video.cost.toLocaleString()}`;
      me.lastVideoAt = state.hour;
      if (target) for (const c of crewsOfNetwork(ctx, target)) c.morale = clamp(c.morale - t.video.morale * m);
      else for (const c of crewsOfNetwork(ctx, net)) c.morale = clamp(c.morale + t.video.morale * m);
      me.profile = clamp(me.profile + t.video.profile * traitProduct(state, content, me.id, 'profileGainMultiplier'));
      me.respect = clamp(me.respect + t.video.respect * m);
      const home = homeRegion(state, content, cmd.issuer);
      for (const [id, r] of Object.entries(state.regions)) r.calentura = clamp(r.calentura + (id === home ? t.video.calentura : t.video.statewideCalentura));
      const head = target ? netHead(ctx, target) : null;
      const text = renderMessage(ctx, 'video', target ? ['threat'] : ['morale'], { sender: cmd.issuer, target: head, against: target });
      pushFeed(state, 'important', `A video spreads across Sinaloa: ${text}`, me.homePlaza, null);
      return null;
    }
    case 'social_claim': {
      if (me.lastClaimAt !== null && state.hour - me.lastClaimAt < t.claim.cooldownDays * 24) return 'you posted a claim only days ago';
      if (cmd.against === net || !(state.factions[cmd.against] || state.characters[cmd.against])) return 'name a rival side';
      me.lastClaimAt = state.hour;
      const isTrue = cmd.claim === 'victory' ? wonRecently(ctx, net, t.claim.trueWindowDays) : looksWeak(ctx, cmd.against);
      for (const c of crewsOfNetwork(ctx, net)) c.morale = clamp(c.morale + t.claim.morale * m);
      for (const c of crewsOfNetwork(ctx, cmd.against)) c.morale = clamp(c.morale - (t.claim.morale * m) / 2);
      state.publicClaims.push({ id: newId(state, 'claim'), owner: cmd.issuer, kind: cmd.claim, against: cmd.against, isFalse: !isTrue, at: state.hour, exposed: false });
      const text = renderMessage(ctx, 'social_claim', cmd.claim === 'victory' ? ['victory'] : ['weakness'], { sender: cmd.issuer, target: netHead(ctx, cmd.against), against: cmd.against });
      pushFeed(state, 'routine', `Posted: “${text}”`, null, null);
      return null;
    }
    case 'commission_corrido': {
      if (me.corridoUntil !== null && me.corridoUntil > state.hour) return 'your corrido is still on every radio';
      if (!spend(state, content, cmd.issuer, t.corrido.cost, 'messages')) return `a corrido costs $${t.corrido.cost.toLocaleString()}`;
      me.corridoUntil = state.hour + t.corrido.days * 24;
      me.profile = clamp(me.profile + t.corrido.profile);
      me.stateIntel = clamp(me.stateIntel + t.corrido.stateIntel);
      const title = renderMessage(ctx, 'corrido', ['respect'], { sender: cmd.issuer, plaza: me.homePlaza });
      pushFeed(state, 'important', `A new corrido is playing in the cantinas: “${title}”.`, me.homePlaza, null);
      return null;
    }
    case 'plant_rumor':
      return plantRumor(ctx, cmd.issuer, cmd.network, cmd.kind, cmd.subject ?? null, false, cmd.node ?? null);
    case 'show_of_force': {
      const p = state.nodes[cmd.node];
      if (!p || p.owner !== cmd.issuer) return 'a show of force needs a plaza you hold';
      const here = Object.keys(state.crews)
        .sort()
        .map((id) => state.crews[id]!)
        .filter((c) => c.owner === cmd.issuer && c.battle === null && c.location.kind === 'node' && c.location.node === cmd.node && c.order.type !== 'escort');
      if (!here.length) return 'you need crews there to parade';
      const s = t.showOfForce;
      me.fear = clamp(me.fear + s.fear * m * traitProduct(state, content, me.id, 'fearGain'));
      me.respect = clamp(me.respect + s.respect * m);
      p.recruits += s.recruits;
      p.support = clamp(p.support + s.support);
      const r = regionOf(cmd.node);
      if (r) r.calentura = clamp(r.calentura + s.calentura * traitProduct(state, content, me.id, 'calenturaMultiplier'));
      for (const other of [...new Set([...majorFactions(content), ...Object.keys(state.characters).filter((id) => state.characters[id]!.faction === null)])].sort()) {
        if (other === net) continue;
        for (const c of here) report(ctx, other, groupOf(state, c), 'presence', 'confirmed', null);
      }
      const men = here.reduce((n, c) => n + c.men, 0);
      pushFeed(state, 'important', `${charName(ctx, cmd.issuer)} parades ${men} armed men through ${w.node(cmd.node).name}.`, cmd.node, null);
      return null;
    }
  }
}

function wonRecently(ctx: SimContext, net: NetworkId, days: number): boolean {
  const since = ctx.state.hour - days * 24;
  return Object.values(ctx.state.battles).some(
    (b) => b.endedAt !== null && b.endedAt >= since && b.winner !== null && b[b.winner].network === net,
  );
}

function looksWeak(ctx: SimContext, net: NetworkId): boolean {
  const f = ctx.state.factions[net];
  return !!f && (f.exhaustion >= 50 || f.supply < 40);
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

export function runInfowarDaily(ctx: SimContext): void {
  const { state, content } = ctx;
  const t = content.tuning.infowar;

  // Rumors: the target's sharpest mind may see through them.
  for (const r of state.rumors) {
    if (r.discovered || r.until <= state.hour) continue;
    const p = t.rumor.discoveryBaseChance + sharpest(ctx, r.network) * t.rumor.discoveryPerAstucia;
    if (!chance(state.rng, p)) continue;
    r.discovered = true;
    state.reports = state.reports.filter((x) => !r.reports.includes(x.id));
    const liar = state.characters[r.owner];
    if (liar) liar.credibility = clamp(liar.credibility - t.rumor.credibilityLoss);
    const head = netHead(ctx, r.network);
    if (head) addOpinion(state, content, head, r.owner, 'planted_lies', t.rumor.targetOpinion, content.tuning.events.opinionDecayDays);
    pushFeed(state, 'important', `A rumor was traced back to ${charName(ctx, r.owner)}.`, null, r.network);
    pushFeed(state, 'important', `Your rumor in ${networkName(ctx, r.network)}'s ranks was found out.`, null, networkOf(state, r.owner));
  }
  state.rumors = state.rumors.filter((r) => r.until > state.hour);

  // False claims get debunked by sharp rivals.
  for (const c of state.publicClaims) {
    if (!c.isFalse || c.exposed) continue;
    const p = t.claim.exposureBaseChance + sharpest(ctx, c.against) * t.claim.exposurePerAstucia;
    if (!chance(state.rng, p)) continue;
    c.exposed = true;
    const liar = state.characters[c.owner];
    if (liar) liar.credibility = clamp(liar.credibility - t.claim.credibilityLoss);
    pushFeed(state, 'important', `${networkName(ctx, c.against)} proved ${charName(ctx, c.owner)}'s claim false. Fewer people believe ${charName(ctx, c.owner)} now.`, null, null);
  }
  state.publicClaims = state.publicClaims.filter((c) => state.hour - c.at < t.claim.exposureDays * 24);

  // Corridos keep playing.
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (ch.corridoUntil === null || ch.corridoUntil <= state.hour || ch.status === 'dead') continue;
    ch.respect = clamp(ch.respect + t.corrido.respectPerDay);
    const home = ch.homePlaza ? state.nodes[ch.homePlaza] : undefined;
    if (home && home.owner === id) home.recruits += t.corrido.recruitsPerDay;
  }
}
