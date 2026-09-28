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
import { parseSave, serializeSave } from '../sim/save';
import { playerNetwork } from './util';

const SAVE_KEY = 'cartel-conquest.autosave';

/** Browser storage can be missing or full (private windows, embedded previews): saving is best effort. */
function autosave(game: GameState): void {
  try {
    localStorage.setItem(SAVE_KEY, serializeSave(game));
  } catch {
    // No storage: the game still plays, it just cannot be resumed.
  }
}

function loadAutosave(): GameState | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? parseSave(text) : null;
  } catch {
    return null;
  }
}

/** A short description of the autosave for the start screen, or null. */
export function autosaveSummary(): string | null {
  const g = loadAutosave();
  if (!g) return null;
  const ch = g.characters[g.playerId];
  const name = ch ? (ch.alias ?? ch.name) : g.playerId;
  return `${name}, day ${Math.floor(g.hour / 24)}${g.ended ? ' (war over)' : ''}`;
}

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
  start: (playerId: Id, seed: number, neutral?: boolean) => void;
  /** Resume the autosaved game, if there is one. */
  resume: () => boolean;
  /** Leave the current game for the character select screen. */
  quit: () => void;
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
  start: (playerId, seed, neutral = false) => {
    const game = newGame(get().content, { seed, playerId, neutrals: neutral ? [playerId] : [] });
    set({ game, speed: 0, queue: [], selected: null, plan: null, deferredEvents: [], lastError: null });
    autosave(game);
  },
  resume: () => {
    const game = loadAutosave();
    if (!game) return false;
    set({ game, speed: 0, queue: [], selected: null, plan: null, deferredEvents: [], lastError: null });
    return true;
  },
  quit: () => {
    const { game } = get();
    if (game) autosave(game);
    set({ game: null, speed: 0, queue: [], selected: null, plan: null });
  },
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
    // Autosave once per in-game day, and when the game ends.
    if (state.hour % 24 === 0 || (state.ended && !game.ended)) autosave(state);
    // A plan for a crew that no longer exists (or is no longer ours) is dropped.
    const plan = get().plan;
    const planOk = !plan || state.crews[plan.crew]?.owner === state.playerId;
    set({
      ...(planOk ? {} : { plan: null }),
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
