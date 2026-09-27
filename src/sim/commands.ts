/**
 * Commands are the only way to change game state from outside the sim. The UI
 * and the AI both issue them; the core validates and applies them at the start
 * of the next tick.
 */
import type { ExtortionRate } from '../data/schemas';
import type { SimContext } from './context';
import type { CrewOrder, Id } from './state';

interface Base {
  /** Character issuing the command. */
  issuer: Id;
}

export type Command =
  | (Base & { type: 'declare_alignment'; faction: Id | null })
  | (Base & { type: 'set_extortion_rate'; node: Id; rate: ExtortionRate })
  | (Base & { type: 'set_halcon_coverage'; node: Id; coverage: number })
  | (Base & { type: 'order_crew'; crew: Id; order: CrewOrder })
  | (Base & { type: 'choose_event_option'; instance: Id; option: number });

export interface Rejection {
  command: Command;
  reason: string;
}

/** Applies one command in place. Returns a reason string if it was rejected. */
export function applyCommand(ctx: SimContext, cmd: Command): string | null {
  const { state, content } = ctx;
  const issuer = state.characters[cmd.issuer];
  if (!issuer) return `unknown issuer "${cmd.issuer}"`;
  if (issuer.status !== 'free') return `${issuer.name} is ${issuer.status}`;

  switch (cmd.type) {
    case 'declare_alignment': {
      if (cmd.faction !== null && !content.factions.some((f) => f.id === cmd.faction && f.kind === 'major'))
        return `"${cmd.faction}" is not a major faction`;
      // TODO(diplomacy): side-switch penalties once day 0 has passed.
      issuer.faction = cmd.faction;
      return null;
    }
    case 'set_extortion_rate': {
      const node = state.nodes[cmd.node];
      if (!node) return `unknown node "${cmd.node}"`;
      if (node.owner !== cmd.issuer) return `${issuer.name} does not own ${cmd.node}`;
      node.extortionRate = cmd.rate;
      return null;
    }
    case 'set_halcon_coverage': {
      const node = state.nodes[cmd.node];
      if (!node) return `unknown node "${cmd.node}"`;
      if (node.owner !== cmd.issuer) return `${issuer.name} does not own ${cmd.node}`;
      if (!Number.isInteger(cmd.coverage) || cmd.coverage < 0 || cmd.coverage > 100 || cmd.coverage % 10 !== 0)
        return 'coverage must be 0–100 in steps of 10';
      node.halconCoverage = cmd.coverage;
      return null;
    }
    case 'order_crew': {
      const crew = state.crews[cmd.crew];
      if (!crew) return `unknown crew "${cmd.crew}"`;
      if (crew.owner !== cmd.issuer) return `${issuer.name} does not command ${cmd.crew}`;
      // TODO(movement): validate routes against roads and vehicle road limits.
      crew.order = cmd.order;
      return null;
    }
    case 'choose_event_option': {
      const idx = state.pendingEvents.findIndex((e) => e.instance === cmd.instance);
      if (idx < 0) return `no pending event "${cmd.instance}"`;
      const pending = state.pendingEvents[idx]!;
      const def = content.events.find((e) => e.id === pending.event);
      if (!def || cmd.option < 0 || cmd.option >= def.options.length) return `invalid option ${cmd.option}`;
      // TODO(events): apply def.options[cmd.option].effects.
      state.pendingEvents.splice(idx, 1);
      return null;
    }
  }
}
