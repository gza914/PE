/**
 * The balance runner (GDD "Developer tools", "Balance targets"): plays whole
 * AI-vs-AI campaigns headless and measures what the GDD's targets ask about.
 */
import type { Content } from '../data/content';
import { checkInvariants } from './invariants';
import { networkOf } from './network';
import { newGame } from './newGame';
import type { GameState, Id } from './state';
import { territoryShares } from './systems/economy';
import { advance } from './tick';

export interface CampaignStats {
  seed: number;
  days: number;
  reason: string;
  winner: Id | null;
  battles: Record<string, number>;
  casualties: number;
  offensives: Record<string, Record<string, number>>;
  captures: Record<string, number>;
  quietStretches: number;
  maxExhaustion: Record<string, number>;
  deaths: number;
  neutralsHeldAt60: number;
  neutrals: number;
  lieutenants: number;
  shortfalls: number;
  invariantProblems: string[];
  msPerTick: number;
  /** One line every `timelineDays` days, when asked for. */
  timeline: string[];
}

export interface CampaignOptions {
  playerId?: string;
  neutrals?: Id[];
  maxDays?: number;
  timelineDays?: number;
}

export function runCampaign(content: Content, seed: number, opts: CampaignOptions = {}): CampaignStats {
  const state = newGame(content, { seed, playerId: opts.playerId ?? 'c_mazatlan', neutrals: opts.neutrals ?? [], autoplay: true });
  const maxHours = (opts.maxDays ?? content.tuning.clock.maxDays) * 24;
  const majors = content.factions.filter((f) => f.kind === 'major').map((f) => f.id);
  const lieutenants = Object.values(state.characters).filter((c) => !['head', 'crew_leader'].includes(c.rank)).map((c) => c.id);
  const neutrals = (opts.neutrals ?? []).filter((id) => state.characters[id]?.faction === null);
  const stats: CampaignStats = {
    seed,
    days: 0,
    reason: '',
    winner: null,
    battles: {},
    casualties: 0,
    offensives: Object.fromEntries(majors.map((f) => [f, {}])),
    captures: Object.fromEntries(majors.map((f) => [f, 0])),
    quietStretches: 0,
    maxExhaustion: Object.fromEntries(majors.map((f) => [f, 0])),
    deaths: 0,
    neutralsHeldAt60: 0,
    neutrals: neutrals.length,
    lieutenants: lieutenants.length,
    shortfalls: 0,
    invariantProblems: [],
    msPerTick: 0,
    timeline: [],
  };
  let periodBattles = 0;
  let periodOffensives = 0;
  const seenBattles = new Set<Id>();
  const endedBattles = new Set<Id>();
  const seenOffensives = new Set<Id>();
  const shortfall = new Set<Id>();
  let owners = ownersNet(state);
  let quietRun = 0;
  let dayBattleHours = 0;
  const t0 = performance.now();

  while (!state.ended && state.hour < maxHours) {
    advance(state, [], content);
    for (const b of Object.values(state.battles)) {
      if (!seenBattles.has(b.id)) {
        seenBattles.add(b.id);
        periodBattles += 1;
        stats.battles[b.type] = (stats.battles[b.type] ?? 0) + 1;
      }
      if (b.endedAt === null && b.type !== 'urban_skirmish') dayBattleHours += 1;
      if (b.endedAt !== null && !endedBattles.has(b.id)) {
        endedBattles.add(b.id);
        stats.casualties += b.attackers.casualties + b.defenders.casualties;
      }
    }
    for (const o of state.offensives) {
      if (o.endedAt !== null && !seenOffensives.has(o.id)) {
        seenOffensives.add(o.id);
        periodOffensives += 1;
        const f = stats.offensives[o.faction] ?? (stats.offensives[o.faction] = {});
        f[o.status] = (f[o.status] ?? 0) + 1;
      }
    }
    for (const f of majors) stats.maxExhaustion[f] = Math.max(stats.maxExhaustion[f]!, state.factions[f]!.exhaustion);
    for (const id of lieutenants) if ((state.characters[id]?.missedPayrollWeeks ?? 0) > 0) shortfall.add(id);
    const now = ownersNet(state);
    for (const [node, net] of Object.entries(now)) {
      if (net && owners[node] !== net && stats.captures[net] !== undefined) stats.captures[net] += 1;
    }
    owners = now;
    if (state.hour % 24 === 0) {
      quietRun = dayBattleHours === 0 ? quietRun + 1 : 0;
      if (quietRun === 5) stats.quietStretches += 1;
      dayBattleHours = 0;
      if (state.hour === 60 * 24) stats.neutralsHeldAt60 = neutrals.filter((id) => Object.values(state.nodes).some((n) => n.owner === id)).length;
      for (const p of checkInvariants(state, content)) if (stats.invariantProblems.length < 20) stats.invariantProblems.push(`day ${state.hour / 24}: ${p}`);
      if (opts.timelineDays && (state.hour / 24) % opts.timelineDays === 0) {
        const shares = territoryShares(state, content);
        const men = (f: Id) => Object.values(state.crews).filter((c) => networkOf(state, c.owner) === f).reduce((n, c) => n + c.men, 0);
        stats.timeline.push(
          `day ${String(state.hour / 24).padStart(3)}  ` +
            majors
              .map((f) => {
                const fs = state.factions[f]!;
                return `${f.slice(0, 4)} share ${Math.round((shares.get(f) ?? 0) * 100)}% men ${men(f)} exh ${Math.round(fs.exhaustion)} sup ${Math.round(fs.supply)} ${fs.warPlan.mode}`;
              })
              .join(' | ') +
            `  battles ${periodBattles} offensives ${periodOffensives}`,
        );
        periodBattles = 0;
        periodOffensives = 0;
      }
    }
  }
  stats.msPerTick = (performance.now() - t0) / Math.max(1, state.hour);
  stats.days = Math.floor(state.hour / 24);
  stats.reason = state.ended?.reason ?? 'unfinished';
  stats.winner = state.ended?.winner ?? null;
  stats.deaths = Object.values(state.characters).filter((c) => c.status === 'dead').length;
  stats.shortfalls = shortfall.size;
  return stats;
}

/** Owning network per node (captures are counted when this changes). */
function ownersNet(state: GameState): Record<Id, Id | null> {
  const out: Record<Id, Id | null> = {};
  for (const n of Object.values(state.nodes)) out[n.id] = n.owner ? networkOf(state, n.owner) : null;
  return out;
}

export interface BalanceReport {
  runs: CampaignStats[];
  medianDays: number;
  timeCapShare: number;
  winShare: Record<string, number>;
  meanQuietStretches: number;
  neutralHoldShare: number | null;
  shortfallShare: number;
  invariantFailures: number;
  lines: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

export function summarize(content: Content, runs: CampaignStats[]): BalanceReport {
  const majors = content.factions.filter((f) => f.kind === 'major').map((f) => f.id);
  const decided = runs.filter((r) => r.winner !== null);
  const winShare = Object.fromEntries(majors.map((f) => [f, decided.length ? decided.filter((r) => r.winner === f).length / decided.length : 0]));
  const withNeutrals = runs.filter((r) => r.neutrals > 0);
  const neutralHoldShare = withNeutrals.length ? withNeutrals.reduce((n, r) => n + r.neutralsHeldAt60, 0) / withNeutrals.reduce((n, r) => n + r.neutrals, 0) : null;
  const report: BalanceReport = {
    runs,
    medianDays: median(runs.map((r) => r.days)),
    timeCapShare: runs.filter((r) => r.reason === 'time_cap').length / Math.max(1, runs.length),
    winShare,
    meanQuietStretches: runs.reduce((n, r) => n + r.quietStretches, 0) / Math.max(1, runs.length),
    neutralHoldShare,
    shortfallShare: runs.reduce((n, r) => n + r.shortfalls, 0) / Math.max(1, runs.reduce((n, r) => n + r.lieutenants, 0)),
    invariantFailures: runs.reduce((n, r) => n + r.invariantProblems.length, 0),
    lines: [],
  };
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const ok = (b: boolean) => (b ? 'PASS' : 'MISS');
  const L = report.lines;
  L.push(`Campaigns: ${runs.length}`);
  for (const r of runs) {
    const offs = majors.map((f) => `${f[0]}:${Object.entries(r.offensives[f] ?? {}).map(([k, v]) => `${k[0]}${v}`).join('')}`).join(' ');
    L.push(
      `  seed ${String(r.seed).padStart(3)}  day ${String(r.days).padStart(3)}  ${r.reason.padEnd(18)} winner ${String(r.winner).padEnd(9)} battles ${String(Object.values(r.battles).reduce((a, b) => a + b, 0)).padStart(3)}  dead ${r.deaths}  quiet ${r.quietStretches}  maxExh ${majors.map((f) => Math.round(r.maxExhaustion[f]!)).join('/')}  captures ${majors.map((f) => r.captures[f]).join('/')}  offensives ${offs}  ${r.msPerTick.toFixed(2)}ms/t`,
    );
  }
  L.push('');
  L.push(`War length       median ${report.medianDays} days (target 120-200)                         ${ok(report.medianDays >= 120 && report.medianDays <= 200)}`);
  L.push(`Time cap         ${pct(report.timeCapShare)} of runs (target under 10%)                          ${ok(report.timeCapShare < 0.1)}`);
  L.push(`Faction balance  ${majors.map((f) => `${f} ${pct(winShare[f]!)}`).join(', ')} of decided runs (target 40-60% each)   ${ok(majors.every((f) => winShare[f]! >= 0.4 && winShare[f]! <= 0.6))}`);
  L.push(`Pulse            ${report.meanQuietStretches.toFixed(1)} quiet stretches of 5+ days per campaign (target 3+)    ${ok(report.meanQuietStretches >= 3)}`);
  if (neutralHoldShare !== null) L.push(`Neutral risk     ${pct(neutralHoldShare)} of neutrals hold a plaza on day 60 (target about 50%)   ${ok(neutralHoldShare >= 0.35 && neutralHoldShare <= 0.65)}`);
  L.push(`Money pressure   ${pct(report.shortfallShare)} of lieutenants missed a payroll (target: a typical one does)   ${ok(report.shortfallShare >= 0.5)}`);
  L.push(`Invariants       ${report.invariantFailures} problems                                          ${ok(report.invariantFailures === 0)}`);
  return report;
}
