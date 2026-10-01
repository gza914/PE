/**
 * AI dealings with outside cartels (GDD "Outside cartels", "AI"): a faction
 * head whose side is losing ground hires a contingent with cash, takes a
 * counter it can afford, and walks from one it cannot. AI bosses turn down
 * contingents that offer to defect: it is not worth a cartel's anger.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { cashOf } from '../money';
import { askPrice, contactVia, dealerBlocked, NO_OFFER, outsideCartels } from '../outside';
import { chance } from '../rng';
import type { Id } from '../state';
import { territoryShares, weeklyObligations } from '../systems/economy';
import { isAi, majorFactions, stagger } from './util';

export function runOutside(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const a = content.tuning.outside.ai;
  const cmds: Command[] = [];
  for (const c of Object.values(state.crews).sort((x, y) => (x.id < y.id ? -1 : 1))) {
    if (c.hired?.kind === 'contingent' && c.hired.defectOffer !== null && isAi(state, c.owner)) cmds.push({ type: 'answer_defection', issuer: c.owner, crew: c.id, accept: false });
  }
  const shares = territoryShares(state, content);
  for (const id of Object.keys(state.characters).sort()) {
    if (!isAi(state, id) || dealerBlocked(state, id) !== null) continue;
    if ((state.hour + stagger(`outside:${id}`, 24)) % 24 !== 0) continue;
    const reserve = a.reserveWeeks * weeklyObligations(state, content, id);
    const open = state.outsideDeals.find((d) => d.client === id && d.status === 'open');
    if (open) {
      const c = open.counter;
      if (c && cashOf(state, id) - c.cash >= reserve && !c.plazaNow) cmds.push({ type: 'outside_accept', issuer: id, deal: open.id });
      else cmds.push({ type: 'outside_walk', issuer: id, deal: open.id });
      continue;
    }
    const me = state.characters[id]!;
    const mine = me.faction ? (shares.get(me.faction) ?? 0) : 0;
    const enemy = Math.max(0, ...majorFactions(content).filter((f) => f !== me.faction).map((f) => shares.get(f) ?? 0));
    if (enemy <= 0 || mine / enemy >= a.hireWhenRatioBelow) continue;
    if (Object.values(state.crews).some((c) => c.owner === id && c.hired?.kind === 'contingent')) continue;
    const node = me.homePlaza && state.nodes[me.homePlaza]?.owner === id ? me.homePlaza : (Object.keys(state.nodes).sort().find((n) => state.nodes[n]!.owner === id && n !== content.culiacan.parentNode) ?? null);
    if (!node) continue;
    const cartel = pickCartel(ctx, id);
    if (!cartel) continue;
    const tier = content.tuning.outside.cartels[cartel]!.tiers[a.tier]!;
    const ask = { kind: 'men' as const, tier: a.tier, men: Math.min(a.men, tier.maxMen, content.tuning.crews.maxMen), node };
    const price = askPrice(state, content, cartel, id, ask).upfront;
    const cash = Math.round((price * a.cashShareOfPrice) / 1000) * 1000;
    if (cashOf(state, id) - cash < reserve) continue;
    if (!chance(state.rng, a.dailyChance)) continue;
    cmds.push({ type: 'outside_deal', issuer: id, cartel, ask, offer: { ...NO_OFFER, cash } });
  }
  return cmds;
}

function pickCartel(ctx: SimContext, id: Id): Id | null {
  const { state, content } = ctx;
  return (
    outsideCartels(content).find((c) => {
      const o = state.outsiders[c];
      return o && !o.hostile.includes(id) && (o.silentUntil[id] ?? -1) <= state.hour && contactVia(state, content, id, c) !== null;
    }) ?? null
  );
}
