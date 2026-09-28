/**
 * AI economy, once a day per AI character: refill crews toward full strength
 * when the money allows, squeeze harder when broke, and ease off where locals
 * turn. GDD: "Economy", "AI".
 */
import type { ExtortionRate } from '../../data/schemas';
import type { Command } from '../commands';
import type { SimContext } from '../context';
import { cashOf } from '../money';
import { seats } from '../signature';
import { characterTerritory, weeklyObligations } from '../systems/economy';
import { aiManaged, stagger } from './util';

const RATES: ExtortionRate[] = ['low', 'medium', 'high', 'brutal'];

/**
 * Once a day per AI character: refill crews toward full strength when the
 * money allows, squeeze harder when broke, and ease off where locals turn.
 */
export function runEconomy(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const e = content.tuning.economy;
  const cmds: Command[] = [];
  for (const id of Object.keys(state.characters).sort()) {
    const ch = state.characters[id]!;
    if (!aiManaged(state, id)) continue;
    if ((state.hour + stagger(id, 24)) % 24 !== 12) continue;
    const plazas = Object.values(state.nodes)
      .filter((n) => n.owner === id)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!plazas.length) continue;
    const weekly = weeklyObligations(state, content, id);
    let cash = cashOf(state, id);
    const broke = ch.missedPayrollWeeks > 0 || cash < weekly;

    if (!broke) {
      const reserve = content.tuning.ai.economyReserveWeeks * weekly;
      for (const crew of Object.values(state.crews).sort((a, b) => (a.id < b.id ? -1 : 1))) {
        if (crew.owner !== id || crew.battle !== null || crew.location.kind !== 'node') continue;
        const plaza = state.nodes[crew.location.node];
        if (!plaza || plaza.owner !== id) continue;
        const need = Math.min(crew.establishment - crew.men, Math.floor(plaza.recruits), content.tuning.crews.maxMen - crew.men);
        if (need <= 0) continue;
        const seatsShort = Math.max(0, crew.men + need - seats(crew, content.tuning));
        const pickups = Math.ceil(seatsShort / content.tuning.vehicles.pickup.seats);
        const cost = need * e.recruitment.signingCostPerMan + pickups * content.tuning.vehicles.pickup.cost;
        if (cash - cost < reserve) continue;
        if (pickups > 0) cmds.push({ type: 'buy_vehicles', issuer: id, crew: crew.id, vehicle: 'pickup', count: pickups });
        cmds.push({ type: 'recruit', issuer: id, crew: crew.id, men: need });
        cash -= cost;
      }
    }

    // Crews lost for good are replaced with new ones, raised where recruits are plentiful.
    if (!broke) {
      const fielded = Object.values(state.crews)
        .filter((c) => c.owner === id)
        .reduce((n, c) => n + c.men, 0);
      const { minMen, maxMen } = content.tuning.crews;
      const g = content.tuning.ai.forceGrowth;
      const growth =
        ch.baseTerritory > 0 && state.hour >= g.startDay * 24 ? Math.max(g.min, Math.min(g.max, characterTerritory(state, content, id) / ch.baseTerritory)) : 1;
      const shortfall = Math.round(ch.forceTarget * growth) - fielded;
      const base = [...plazas].sort((a, b) => b.recruits - a.recruits || (a.id < b.id ? -1 : 1))[0]!;
      const men = Math.min(maxMen, shortfall, Math.floor(base.recruits));
      const cost = men * e.recruitment.signingCostPerMan + Math.ceil(men / content.tuning.vehicles.pickup.seats) * content.tuning.vehicles.pickup.cost;
      if (shortfall >= minMen && men >= minMen && cash - cost >= content.tuning.ai.economyReserveWeeks * weekly) {
        cmds.push({ type: 'form_crew', issuer: id, node: base.id, men });
        cash -= cost;
      }
    }

    for (const p of plazas) {
      const i = RATES.indexOf(p.extortionRate);
      if (p.support < 25 && i >= 2) cmds.push({ type: 'set_extortion_rate', issuer: id, node: p.id, rate: RATES[i - 1]! });
    }
    if (broke) {
      const richest = [...plazas].sort((a, b) => b.businesses - a.businesses)[0]!;
      const i = RATES.indexOf(richest.extortionRate);
      if (i < 2 && richest.support >= 35) cmds.push({ type: 'set_extortion_rate', issuer: id, node: richest.id, rate: RATES[i + 1]! });
      const watched = [...plazas].sort((a, b) => b.halconCoverage - a.halconCoverage)[0]!;
      if (watched.halconCoverage > 30) cmds.push({ type: 'set_halcon_coverage', issuer: id, node: watched.id, coverage: watched.halconCoverage - 10 });
    }
  }
  return cmds;
}
