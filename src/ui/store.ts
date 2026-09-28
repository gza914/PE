/**
 * Bridge between the sim and React. The UI never edits GameState: it queues
 * Commands, and step() hands them to the sim on the next tick.
 */
import { create } from 'zustand';
import { bundledContent } from '../data/bundled';
import type { Content } from '../data/content';
import type { Command } from '../sim/commands';
import { newGame } from '../sim/newGame';
import type { GameState, Id } from '../sim/state';
import { tick } from '../sim/tick';
import { playerNetwork } from './util';

export type Selection = { kind: 'node' | 'colonia' | 'crew' | 'road' | 'battle' | 'character'; id: Id } | null;
export type Overlay = 'none' | 'halcones' | 'calentura' | 'income' | 'war';

/** Route planning in progress for one crew. */
export interface PlanMode {
  kind: 'move' | 'raid';
  crew: Id;
  destination: Id | null;
  waypoints: Id[];
}

interface GameStore {
  content: Content;
  game: GameState | null;
  /** 0 = paused, 1–5 = speed. UI-only; does not affect the simulation. */
  speed: number;
  queue: Command[];
  view: 'state' | 'culiacan';
  selected: Selection;
  plan: PlanMode | null;
  overlay: Overlay;
  /** Debug: lift the fog of war. */
  revealAll: boolean;
  autoPause: boolean;
  /** Last sync-arrival hour entered, reused so several crews can share it. */
  syncHour: number | null;
  lastError: string | null;
  /** Pending events the player put aside for now ("Decide later"). */
  deferredEvents: Id[];
  start: (playerId: Id, seed: number) => void;
  setSpeed: (speed: number) => void;
  togglePause: () => void;
  enqueue: (cmd: Command) => void;
  step: () => void;
  set: (patch: Partial<Pick<GameStore, 'view' | 'selected' | 'plan' | 'overlay' | 'revealAll' | 'autoPause' | 'syncHour' | 'lastError' | 'deferredEvents'>>) => void;
  select: (sel: Selection) => void;
}

let lastSpeed = 1;

export const useGame = create<GameStore>((set, get) => ({
  content: bundledContent(),
  game: null,
  speed: 0,
  queue: [],
  view: 'state',
  selected: null,
  plan: null,
  overlay: 'none',
  revealAll: false,
  autoPause: true,
  syncHour: null,
  lastError: null,
  deferredEvents: [],
  start: (playerId, seed) => set({ game: newGame(get().content, { seed, playerId }), speed: 0, queue: [], selected: null, plan: null, deferredEvents: [] }),
  setSpeed: (speed) => {
    if (speed > 0) lastSpeed = speed;
    set({ speed });
  },
  togglePause: () => get().setSpeed(get().speed === 0 ? lastSpeed : 0),
  enqueue: (cmd) =>
    set((s) => ({
      // A newer order for the same crew replaces a queued one.
      queue: [...s.queue.filter((q) => !(cmd.type === 'order_crew' && q.type === 'order_crew' && q.crew === cmd.crew)), cmd],
      lastError: null,
    })),
  step: () => {
    const { game, queue, content, autoPause } = get();
    if (!game) return;
    const { state, rejected } = tick(game, queue, content);
    const net = playerNetwork(state);
    const lastId = game.feed.at(-1)?.id;
    const startIdx = lastId ? state.feed.findIndex((f) => f.id === lastId) + 1 : 0;
    const alarm = state.feed.slice(startIdx).some((f) => f.tier === 'critical' && (f.audience === null || f.audience === net));
    const error = rejected.find((r) => r.command.issuer === state.playerId)?.reason ?? null;
    set({
      game: state,
      queue: [],
      speed: state.ended || (autoPause && alarm) ? 0 : get().speed,
      lastError: error,
    });
  },
  set: (patch) => set(patch),
  select: (selected) => set({ selected, plan: null }),
}));

/** Faction color for a character-owned thing, or a neutral grey. */
export function ownerColor(content: Content, game: GameState, owner: Id | null): string {
  if (!owner) return '#5b6270';
  const faction = game.characters[owner]?.faction;
  return content.factions.find((f) => f.id === faction)?.color ?? '#b9a36b';
}
