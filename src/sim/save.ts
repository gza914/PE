/** Save/load. The RNG state lives inside GameState, so one JSON blob is a full save. */
import { SAVE_VERSION, type GameState } from './state';

const FORMAT = 'cartel-conquest-save';

export function serializeSave(state: GameState): string {
  return JSON.stringify({ format: FORMAT, version: SAVE_VERSION, state });
}

export function parseSave(text: string): GameState {
  const data: unknown = JSON.parse(text);
  if (typeof data !== 'object' || data === null) throw new Error('save is not an object');
  const { format, version, state } = data as { format?: unknown; version?: unknown; state?: unknown };
  if (format !== FORMAT) throw new Error('not a Cartel Conquest save');
  if (version !== SAVE_VERSION) throw new Error(`unsupported save version ${String(version)} (expected ${SAVE_VERSION})`);
  // TODO: validate the state shape with Zod once it stabilizes.
  return state as GameState;
}
