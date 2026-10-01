/**
 * Command fuzzing: throw random commands of every type at the sim, sensible
 * and nonsensical, the way a curious player (or a buggy UI) might, and check
 * it never throws and never breaks an invariant. Seeded, so failures replay.
 */
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/sim/commands';
import { checkInvariants } from '../src/sim/invariants';
import { newGame } from '../src/sim/newGame';
import { rand, seedRng, type RngState } from '../src/sim/rng';
import type { GameState } from '../src/sim/state';
import { tick } from '../src/sim/tick';
import { content } from './helpers';

const pick = <T,>(r: RngState, xs: readonly T[]): T => xs[Math.floor(rand(r) * xs.length)]!;

function randomCommand(s: GameState, r: RngState): Command {
  const me = s.playerId;
  const issuer = rand(r) < 0.9 ? me : pick(r, Object.keys(s.characters));
  const nodes = Object.keys(s.nodes);
  const crews = Object.keys(s.crews);
  const mine = crews.filter((id) => s.crews[id]!.owner === me);
  const crew = mine.length && rand(r) < 0.85 ? pick(r, mine) : crews.length ? pick(r, crews) : 'nope';
  const roads = content.roads.map((x) => x.id);
  const regions = Object.keys(s.regions);
  const chars = Object.keys(s.characters);
  const battles = Object.keys(s.battles);
  const battle = battles.length ? pick(r, battles) : 'nope';
  const nets = ['chapitos', 'mayos', me];
  const node = pick(r, nodes);
  const n = (lo: number, hi: number) => Math.floor(lo + rand(r) * (hi - lo + 1));
  const orders = [
    { type: 'move', destination: node, preference: pick(r, ['fastest', 'balanced', 'safest'] as const), waypoints: rand(r) < 0.2 ? [pick(r, nodes)] : [] },
    { type: 'raid', target: node, preference: 'fastest' },
    { type: 'retreat' },
    { type: 'garrison' },
    { type: 'lie_low' },
    { type: 'idle' },
    { type: 'ambush', road: pick(r, roads) },
    { type: 'patrol', road: pick(r, roads) },
    { type: 'escort', crew: crews.length ? pick(r, crews) : 'nope' },
  ] as const;
  const pe = s.pendingEvents[0];
  const all: Command[] = [
    { type: 'order_crew', issuer, crew, order: pick(r, orders) as never },
    { type: 'order_crew', issuer, crew, order: pick(r, orders) as never },
    { type: 'set_extortion_rate', issuer, node, rate: pick(r, ['low', 'medium', 'high', 'brutal'] as const) },
    { type: 'set_halcon_coverage', issuer, node, coverage: n(-10, 110) },
    { type: 'split_crew', issuer, crew, men: n(0, 30), vehicles: { pickup: n(0, 5) } },
    { type: 'merge_crews', issuer, crew, into: pick(r, crews.length ? crews : ['x']) },
    { type: 'launch_drone', issuer, road: pick(r, roads) },
    { type: 'recruit', issuer, crew, men: n(-2, 20) },
    { type: 'form_crew', issuer, node, men: n(0, 50) },
    { type: 'buy_vehicles', issuer, crew, vehicle: pick(r, ['pickup', 'suv', 'motorcycle', 'armored'] as const), count: n(0, 4) },
    { type: 'move_cash', issuer, from: pick(r, nodes), to: pick(r, nodes), amount: n(-100, 500000) },
    { type: 'request_aid', issuer },
    { type: 'respond_request', issuer, request: s.requests[0]?.id ?? 'nope', accept: rand(r) < 0.5 },
    { type: 'accept_truce', issuer },
    { type: 'deploy_crew', issuer, crew, colonia: rand(r) < 0.8 ? pick(r, content.culiacan.colonias.map((c) => c.id)) : null },
    { type: 'battle_withdraw', issuer, battle },
    { type: 'battle_armor_forward', issuer, battle },
    { type: 'battle_call_help', issuer, battle },
    { type: 'battle_commit', issuer, battle, crew },
    { type: 'battle_accept_surrender', issuer, battle },
    { type: 'choose_event_option', issuer: pe?.decider ?? issuer, instance: pe?.instance ?? 'nope', option: n(-1, 4) },
    { type: 'start_scheme', issuer, scheme: pick(r, ['flip', 'assassinate', 'frame', 'leak_location', 'buy_halcones', 'compadrazgo'] as const), target: rand(r) < 0.5 ? pick(r, chars) : node },
    { type: 'cancel_scheme', issuer, scheme: s.schemes[0]?.id ?? 'nope' },
    { type: 'bribe_commander', issuer, region: pick(r, regions) },
    { type: 'bribe_police', issuer, region: pick(r, regions) },
    { type: 'tip_off', issuer, node },
    { type: 'hand_over_scapegoat', issuer, region: pick(r, regions) },
    { type: 'lie_low_region', issuer, region: rand(r) < 0.9 ? pick(r, regions) : 'atlantis' },
    { type: 'narcomanta', issuer, node, target: rand(r) < 0.5 ? pick(r, chars) : null },
    { type: 'video', issuer, tone: pick(r, ['rally', 'threat'] as const), target: pick(r, nets) },
    { type: 'social_claim', issuer, claim: pick(r, ['victory', 'enemy_weak'] as const), against: pick(r, nets) },
    { type: 'commission_corrido', issuer },
    { type: 'plant_rumor', issuer, network: pick(r, nets), kind: pick(r, ['fake_convoy', 'fake_weakness', 'fake_betrayal'] as const), subject: pick(r, chars), node: rand(r) < 0.5 ? node : null },
    { type: 'show_of_force', issuer, node },
    { type: 'propose_operation', issuer, kind: pick(r, ['attack', 'defend'] as const), target: node, strikeAt: s.hour + n(-5, 120), holdUntil: s.hour + n(0, 200), plaza: pick(r, ['proposer', 'contribution', pick(r, chars)]), crews: mine.length ? [pick(r, mine)] : [], invites: [{ to: pick(r, chars), cash: n(-10, 100000) }] },
    { type: 'respond_operation', issuer: s.operations[0]?.invites[0]?.to ?? issuer, op: s.operations[0]?.id ?? 'nope', accept: rand(r) < 0.6, crews: mine.length ? [pick(r, mine)] : [], counter: rand(r) < 0.2 ? { plaza: rand(r) < 0.5, cash: n(0, 50000) } : null },
    { type: 'accept_counter', issuer, op: s.operations[0]?.id ?? 'nope', invitee: pick(r, chars) },
    { type: 'cancel_operation', issuer, op: s.operations[0]?.id ?? 'nope' },
    { type: 'withdraw_operation', issuer, op: s.operations[0]?.id ?? 'nope' },
    { type: 'propose_pact', issuer, to: pick(r, chars), pact: pick(r, ['non_aggression', 'safe_passage', 'mutual_defense', 'local_truce', 'route_share'] as const), region: pick(r, regions), route: pick(r, content.routes.map((x) => x.id)), share: rand(r), cash: n(-5, 200000), days: n(-1, 60) },
    { type: 'respond_pact', issuer: s.pactOffers[0]?.to ?? issuer, offer: s.pactOffers[0]?.id ?? 'nope', accept: rand(r) < 0.5 },
    { type: 'break_pact', issuer, pact: s.pacts[0]?.id ?? 'nope' },
    { type: 'declare_alignment', issuer, faction: rand(r) < 0.05 ? pick(r, ['chapitos', 'mayos', null] as const) : s.characters[issuer]!.faction },
  ];
  return pick(r, all);
}

// FUZZ_SEEDS=n and FUZZ_DAYS=d run a deeper sweep than the default.
const PLAYERS = ['c_mazatlan', 'm_la_cruz', 'chapitos_head', 'mayos_head', 'c_cosala', 'm_rosario'];
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 3);
const DAYS = Number(process.env.FUZZ_DAYS ?? 25);

describe('command fuzzing', () => {
  for (const [seed, player] of Array.from({ length: SEEDS }, (_, i) => [11 + i, PLAYERS[i % PLAYERS.length]!] as const)) {
    it(`survives random commands (seed ${seed}, ${player})`, () => {
      let s = newGame(content, { seed, playerId: player });
      const r = seedRng(seed * 7919);
      for (let h = 0; h < 24 * DAYS && !s.ended; h++) {
        const cmds = Array.from({ length: 3 }, () => randomCommand(s, r));
        s = tick(s, cmds, content).state;
        if (h % 24 === 23) expect(checkInvariants(s, content), `day ${Math.floor(h / 24)}`).toEqual([]);
      }
      // The state still round-trips through JSON (saves).
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }, 1200000);
  }
});
