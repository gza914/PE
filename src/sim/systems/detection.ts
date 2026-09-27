/**
 * Rolls detection for groups passing watched nodes, resolves drones, and ages last-seen reports.
 * GDD: "Visibility and intelligence". Not implemented yet: the scaffold only fixes the call site.
 */
import type { SimContext } from '../context';

/** Runs every hour. */
export function runDetection(ctx: SimContext): void {
  void ctx;
}
