/**
 * Money. Cash lives in stash houses in the plazas a character holds, plus a
 * purse for cash outside any plaza. Whoever takes a plaza takes its stash.
 * Every movement of money goes through here so the ledger stays complete.
 * GDD: "Cash and stash houses".
 */
import { dayOf } from './clock';
import type { Content } from '../data/content';
import type { CostStream, GameState, Id, IncomeStream, LedgerDay, PlazaState } from './state';

/** Plazas a character holds, largest stash first (ties by id). */
export function stashesOf(state: GameState, id: Id): PlazaState[] {
  return Object.values(state.nodes)
    .filter((n) => n.owner === id)
    .sort((a, b) => b.stash - a.stash || (a.id < b.id ? -1 : 1));
}

export function cashOf(state: GameState, id: Id): number {
  const ch = state.characters[id];
  if (!ch) return 0;
  return ch.purse + stashesOf(state, id).reduce((n, p) => n + p.stash, 0);
}

function today(state: GameState, content: Content, id: Id): LedgerDay | null {
  const ch = state.characters[id];
  if (!ch) return null;
  const day = dayOf(state.hour);
  let entry = ch.ledger[ch.ledger.length - 1];
  if (!entry || entry.day !== day) {
    entry = { day, income: {}, costs: {} };
    ch.ledger.push(entry);
    if (ch.ledger.length > content.tuning.economy.ledgerDays) ch.ledger.splice(0, ch.ledger.length - content.tuning.economy.ledgerDays);
  }
  return entry;
}

/**
 * Adds cash for a character: into `node`'s stash if they hold it, else their
 * home plaza, else their largest stash, else their purse.
 */
export function deposit(state: GameState, content: Content, id: Id, amount: number, stream: IncomeStream, node: Id | null = null): void {
  const ch = state.characters[id];
  if (!ch || amount <= 0) return;
  const held = (n: Id | null) => (n && state.nodes[n]?.owner === id ? state.nodes[n]! : null);
  const target = held(node) ?? held(ch.homePlaza) ?? stashesOf(state, id)[0] ?? null;
  if (target) target.stash += amount;
  else ch.purse += amount;
  const t = today(state, content, id)!;
  t.income[stream] = (t.income[stream] ?? 0) + amount;
}

function withdraw(state: GameState, id: Id, amount: number): void {
  const ch = state.characters[id]!;
  let left = amount;
  const fromPurse = Math.min(ch.purse, left);
  ch.purse -= fromPurse;
  left -= fromPurse;
  for (const p of stashesOf(state, id)) {
    if (left <= 0) break;
    const take = Math.min(p.stash, left);
    p.stash -= take;
    left -= take;
  }
}

/** Spends exactly `amount` if the character has it. Returns false (and spends nothing) otherwise. */
export function spend(state: GameState, content: Content, id: Id, amount: number, stream: CostStream): boolean {
  if (amount <= 0) return true;
  if (cashOf(state, id) + 1e-9 < amount) return false;
  withdraw(state, id, amount);
  const t = today(state, content, id)!;
  t.costs[stream] = (t.costs[stream] ?? 0) + amount;
  return true;
}

/** Spends as much of `amount` as the character has. Returns what was spent. */
export function spendUpTo(state: GameState, content: Content, id: Id, amount: number, stream: CostStream): number {
  const paid = Math.max(0, Math.min(amount, cashOf(state, id)));
  if (paid > 0) spend(state, content, id, paid, stream);
  return paid;
}

/** Moves cash between two of a character's own stash houses. */
export function moveCash(state: GameState, id: Id, from: Id, to: Id, amount: number): string | null {
  const a = state.nodes[from];
  const b = state.nodes[to];
  if (!a || !b || a.owner !== id || b.owner !== id) return 'you can only move cash between your own plazas';
  if (!(amount > 0) || amount > a.stash + 1e-9) return `the stash in ${from} holds $${Math.floor(a.stash).toLocaleString()}`;
  a.stash -= amount;
  b.stash += amount;
  return null;
}

/** Total income and costs over the ledger's last `days` days. */
export function ledgerTotals(state: GameState, id: Id, days: number): { income: number; costs: number } {
  const ch = state.characters[id];
  const entries = ch ? ch.ledger.slice(-days) : [];
  const sum = (o: Partial<Record<string, number>>) => Object.values(o).reduce<number>((n, v) => n + (v ?? 0), 0);
  return { income: entries.reduce((n, e) => n + sum(e.income), 0), costs: entries.reduce((n, e) => n + sum(e.costs), 0) };
}
