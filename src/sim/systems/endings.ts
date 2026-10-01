/**
 * End triggers and scoring. The war ends when a faction collapses, is beaten
 * down to under 20% of the map's value for 14 days, or both sides agree to a
 * truce after 14 days of exhaustion; or at the time cap; or when the player
 * falls with no heir. The score measures the player's improvement over their
 * starting position. GDD: "Endings and scoring".
 */
import type { Content } from '../../data/content';
import { dayOf } from '../clock';
import { pushFeed, type SimContext } from '../context';
import { cashOf } from '../money';
import { networkOf } from '../network';
import { charName } from '../orders';
import { groupPower } from '../power';
import { chance } from '../rng';
import { VEHICLE_TYPES } from '../signature';
import type { EndReason, EndTitle, GameState, Id, ScoreBreakdown, StartSnapshot } from '../state';
import { characterTerritory, territoryShares } from './economy';
import { isGone } from '../state';

const RANK_VALUE = { head: 5, inner_circle: 4, senior_lieutenant: 3, lieutenant: 2, associate: 1, crew_leader: 1 } as const;

function majors(content: Content): string[] {
  return content.factions.filter((f) => f.kind === 'major').map((f) => f.id);
}

/** Cash plus the resale value of vehicles. */
function wealth(state: GameState, content: Content, id: Id): number {
  let v = cashOf(state, id);
  for (const c of Object.values(state.crews)) {
    if (c.owner !== id) continue;
    for (const t of VEHICLE_TYPES) v += c.vehicles[t] * content.tuning.vehicles[t].cost;
  }
  return v;
}

function force(state: GameState, content: Content, id: Id): number {
  return groupPower(
    state,
    content,
    // Lent troops are their cartel's, never yours (GDD "Loaned, not owned").
    Object.values(state.crews).filter((c) => c.owner === id && c.hired?.kind !== 'contingent'),
  );
}

export function snapshot(state: GameState, content: Content, id: Id): StartSnapshot {
  const ch = state.characters[id]!;
  return {
    playerId: id,
    territory: characterTerritory(state, content, id),
    wealth: wealth(state, content, id),
    respect: ch.respect,
    force: force(state, content, id),
    rank: RANK_VALUE[ch.rank],
  };
}

export function scorePlayer(state: GameState, content: Content, winner: Id | null): { score: ScoreBreakdown; title: EndTitle } {
  const t = content.tuning.endings;
  const id = state.playerId;
  const ch = state.characters[id]!;
  const now = snapshot(state, content, id);
  const s = state.start;
  const cap = (x: number) => Math.max(0, Math.min(t.scoreRatioCap, x));
  const ratio = (end: number, start: number) => cap(start > 0 ? end / start : end > 0 ? t.scoreRatioCap : 1);
  const won = winner !== null && ch.faction === winner;
  const lost = winner !== null && ch.faction !== null && ch.faction !== winner;
  const standing = cap((now.rank / Math.max(1, s.rank)) * (won ? 1.25 : lost ? 0.75 : 1));
  const reputation = cap(1 + (now.respect - s.respect) / 100);
  const parts = {
    territory: ratio(now.territory, s.territory),
    wealth: ratio(now.wealth, s.wealth),
    standing,
    reputation,
    force: ratio(now.force, s.force),
  };
  const w = t.scoreWeights;
  const fate = ch.status === 'free' ? t.fateMultipliers.free : ch.status === 'jailed' || ch.status === 'captured' ? t.fateMultipliers.jailed : t.fateMultipliers.deadOrExtradited;
  const total = 100 * fate * (w.territory * parts.territory + w.wealth * parts.wealth + w.standing * parts.standing + w.reputation * parts.reputation + w.force * parts.force);
  let title: EndTitle;
  if (ch.status === 'extradited') title = 'extradited';
  else if (ch.status === 'dead') title = ch.respect >= t.corridoMinRespect ? 'corrido' : 'pawn';
  else if (total >= t.patronMinScore && (won || ch.faction === null)) title = 'el_patron';
  else if (won && ch.declaredAt >= t.kingmakerDeclareAfterDays * 24) title = 'kingmaker';
  // Survivor: kept your plazas (no real ground lost) and your freedom. Pawn: lost ground but lived.
  else if (ch.status === 'free' && now.territory > 0 && parts.territory >= 0.9) title = 'survivor';
  else title = 'pawn';
  return { score: { ...parts, fate, total }, title };
}

/** Ends the campaign, scoring the player. */
export function endGame(ctx: SimContext, reason: EndReason, winner: Id | null, text: string): void {
  const { state, content } = ctx;
  if (state.ended) return;
  const { score, title } = scorePlayer(state, content, winner);
  state.ended = { reason, hour: state.hour, winner, score, title };
  pushFeed(state, 'critical', text, null, null);
}

/** Runs every hour; the day-based triggers only at the daily settle hour. */
export function checkEndings(ctx: SimContext): void {
  const { state, content } = ctx;
  if (state.ended) return;
  const t = content.tuning.endings;
  const fname = (id: string) => content.factions.find((f) => f.id === id)?.name ?? id;
  if (dayOf(state.hour) >= content.tuning.clock.maxDays) {
    const shares = territoryShares(state, content);
    const top = majors(content).sort((a, b) => (shares.get(b) ?? 0) - (shares.get(a) ?? 0))[0]!;
    const winner = (shares.get(top) ?? 0) >= t.timeCapWinnerMinShare ? top : null;
    endGame(ctx, 'time_cap', winner, `Day ${content.tuning.clock.maxDays}: the war ends ${winner ? `with the ${fname(winner)} on top` : 'without a decision'}.`);
    return;
  }
  if (state.hour % 24 !== content.tuning.clock.incomeSettleHour) return;

  const [a, b] = majors(content) as [string, string];
  const shares = territoryShares(state, content);
  for (const f of [a, b]) {
    const fs = state.factions[f]!;
    const other = f === a ? b : a;
    // Territorial defeat.
    fs.lowShareDays = (shares.get(f) ?? 0) < t.territorialDefeatShare ? fs.lowShareDays + 1 : 0;
    if (fs.lowShareDays >= t.territorialDefeatDays) {
      endGame(ctx, 'territorial_defeat', other, `The ${fname(f)} have lost almost everything. The ${fname(other)} win the war.`);
      return;
    }
    // Faction collapse: no free head, and no successor steps up in time.
    const head = fs.head ? state.characters[fs.head] : undefined;
    if (head && head.status === 'free') {
      fs.headlessDays = 0;
      continue;
    }
    // A head in enemy hands or in prison: the faction holds together while anyone could take over.
    if (head && (head.status === 'captured' || head.status === 'jailed') && Object.values(state.characters).some((c) => c.faction === f && c.outsider === null && c.id !== head.id && c.status === 'free')) {
      fs.headlessDays = 0;
      continue;
    }
    fs.headlessDays += 1;
    if (!head || isGone(head.status)) {
      const successor = Object.values(state.characters)
        .filter((c) => c.faction === f && c.outsider === null && c.status === 'free')
        .sort((x, y) => RANK_VALUE[y.rank] - RANK_VALUE[x.rank] || force(state, content, y.id) - force(state, content, x.id) || (x.id < y.id ? -1 : 1))[0];
      if (successor && chance(state.rng, t.successionChancePerDay)) {
        fs.head = successor.id;
        fs.headlessDays = 0;
        pushFeed(state, 'critical', `${charName(ctx, successor.id)} takes command of the ${fname(f)}.`, null, null);
        continue;
      }
    }
    if (fs.headlessDays >= t.factionCollapseSuccessionDays) {
      endGame(ctx, 'faction_collapse', other, `With no one to hold them together, the ${fname(f)} fall apart. The ${fname(other)} win the war.`);
      return;
    }
  }

  // Negotiated truce.
  const thr = content.tuning.diplomacy.truceExhaustionThreshold;
  state.truceDays = state.factions[a]!.exhaustion >= thr && state.factions[b]!.exhaustion >= thr ? state.truceDays + 1 : 0;
  if (state.truceDays >= content.tuning.diplomacy.truceSustainDays) {
    const playerHead = [a, b].some((f) => state.factions[f]!.head === state.playerId);
    const aiAgrees = [a, b].every((f) => state.factions[f]!.head === state.playerId || (shares.get(f) ?? 0) <= t.truceAcceptMaxShare);
    if (!aiAgrees) return;
    if (playerHead) {
      if (!state.truceOffered) {
        state.truceOffered = true;
        pushFeed(state, 'critical', 'Both sides are bled white. The other side offers a truce: accept it from the Faction tab to end the war.', null, networkOf(state, state.playerId));
      }
      return;
    }
    endGame(ctx, 'negotiated_truce', null, 'Exhausted, the faction heads agree to a truce. The war is over.');
  }
}
