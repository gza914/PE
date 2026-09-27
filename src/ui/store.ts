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

export type Selection = { kind: 'node' | 'colonia' | 'crew' | 'character'; id: Id } | null;

interface GameStore {
  content: Content;
  game: GameState | null;
  /** 0 = paused, 1–5 = speed. UI-only; does not affect the simulation. */
  speed: number;
  queue: Command[];
  view: 'state' | 'culiacan';
  selected: Selection;
  start: (playerId: Id, seed: number) => void;
  load: (game: GameState) => void;
  setSpeed: (speed: number) => void;
  togglePause: () => void;
  enqueue: (cmd: Command) => void;
  step: () => void;
  setView: (view: 'state' | 'culiacan') => void;
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
  start: (playerId, seed) => set({ game: newGame(get().content, { seed, playerId }), speed: 0, queue: [], selected: null }),
  load: (game) => set({ game, speed: 0, queue: [], selected: null }),
  setSpeed: (speed) => {
    if (speed > 0) lastSpeed = speed;
    set({ speed });
  },
  togglePause: () => get().setSpeed(get().speed === 0 ? lastSpeed : 0),
  enqueue: (cmd) => set((s) => ({ queue: [...s.queue, cmd] })),
  step: () => {
    const { game, queue, content } = get();
    if (!game) return;
    const { state, rejected } = tick(game, queue, content);
    for (const r of rejected) console.warn('command rejected:', r.reason, r.command);
    set({ game: state, queue: [], speed: state.ended ? 0 : get().speed });
  },
  setView: (view) => set({ view }),
  select: (selected) => set({ selected }),
}));

/** Faction color for a character-owned thing, or a neutral grey. */
export function ownerColor(content: Content, game: GameState, owner: Id | null): string {
  if (!owner) return '#5b6270';
  const faction = game.characters[owner]?.faction;
  return content.factions.find((f) => f.id === faction)?.color ?? '#9aa0aa';
}
