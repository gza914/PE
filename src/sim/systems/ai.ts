/**
 * Utility AI in three layers: strategic (faction heads), operational
 * (lieutenants), tactical (crew leaders). AI issues the same Commands the
 * player does and sees only its own network's reports.
 * GDD: "AI". Not implemented yet: returns no commands.
 */
import type { Command } from '../commands';
import type { SimContext } from '../context';

/** Runs every hour; returns commands to apply next tick. */
export function runAi(ctx: SimContext): Command[] {
  void ctx;
  return [];
}
