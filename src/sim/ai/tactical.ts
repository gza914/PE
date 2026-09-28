/**
 * Tactical layer: crew leaders in battle, every hour (GDD "AI"). Each AI owner
 * with crews in a fight weighs the odds it can see (enemies in contact are in
 * plain sight): withdraw in good order when badly outgunned (unless holding a
 * fortified plaza and not yet hopeless), push the armored trucks forward when
 * the fight is close, and take a surrender when the enemy is breaking.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';
import type { Battle, Id } from '../state';
import { networkOf } from '../network';
import { sidePower } from '../systems/combat';
import { world } from '../world';
import { actionWeight, cautionOf, isAi } from './util';

export function runTactical(ctx: SimContext): Command[] {
  const { state, content } = ctx;
  const t = content.tuning.ai.tactical;
  const cmds: Command[] = [];
  for (const id of Object.keys(state.battles).sort()) {
    const b = state.battles[id]!;
    if (b.endedAt !== null) continue;
    for (const side of ['attackers', 'defenders'] as const) {
      const other = side === 'attackers' ? 'defenders' : 'attackers';
      const own = sidePower(ctx, b, side);
      const enemy = Math.max(1, sidePower(ctx, b, other));
      const ratio = own / enemy;
      const owners = [...new Set(b[side].crews.map((c) => state.crews[c]?.owner).filter((o): o is Id => !!o))].sort();
      for (const owner of owners) {
        if (!isAi(state, owner)) continue;
        const crews = b[side].crews.map((c) => state.crews[c]!).filter((c) => c && c.owner === owner);
        if (!crews.length) continue;
        // Enemy breaking: take the surrender.
        if (enemyWavering(ctx, b, other)) {
          cmds.push({ type: 'battle_accept_surrender', issuer: owner, battle: b.id });
          continue;
        }
        const holding = side === 'defenders' && b.where.kind === 'node' && b.fortification > 0;
        const withdrawAt = Math.min(t.maxWithdrawRatio, t.withdrawRatio * cautionOf(state, content, owner) * actionWeight(state, content, owner, 'withdraw'));
        if (ratio < withdrawAt && !(holding && ratio >= t.fortifiedHoldRatio) && !helpInbound(ctx, b, side)) {
          if (!b.withdrawing.some((c) => crews.some((x) => x.id === c))) cmds.push({ type: 'battle_withdraw', issuer: owner, battle: b.id });
          continue;
        }
        const bold = actionWeight(state, content, owner, 'withdraw') < 1;
        if (bold && ratio >= t.armorPushMinRatio && ratio <= t.armorPushMaxRatio && crews.some((c) => c.vehicles.armored > 0 && c.armorDamage < 50)) {
          cmds.push({ type: 'battle_armor_forward', issuer: owner, battle: b.id });
        }
      }
    }
  }
  return cmds;
}

function enemyWavering(ctx: SimContext, b: Battle, side: 'attackers' | 'defenders'): boolean {
  const list = b[side].crews.map((c) => ctx.state.crews[c]).filter((c) => !!c);
  const men = list.reduce((n, c) => n + c!.men, 0);
  if (!men) return false;
  const morale = list.reduce((n, c) => n + c!.morale * c!.men, 0) / men;
  return morale < ctx.content.tuning.combat.surrenderMorale;
}

/** Friendly crews on their way here that should arrive soon (reinforcements or offensive partners). */
function helpInbound(ctx: SimContext, b: Battle, side: 'attackers' | 'defenders'): boolean {
  const { state, content } = ctx;
  const window = content.tuning.ai.tactical.reinforcementWindowHours;
  const net = b[side].network;
  const node = b.where.kind === 'node' ? b.where.node : null;
  return Object.values(state.crews).some((c) => {
    if (c.battle !== null || networkOf(state, c.owner) !== net) return false;
    const o = c.order;
    const coming = (o.type === 'reinforce' && o.battle === b.id) || (node !== null && o.type === 'raid' && o.target === node);
    if (!coming || !('path' in o)) return false;
    const km = o.path.reduce((sum, s) => sum + world(content).road(s.road).lengthKm, 0);
    return km / 70 <= window;
  });
}
