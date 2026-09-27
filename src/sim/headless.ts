/**
 * Runs a campaign with no UI and no player input, for tests and the balance
 * runner (GDD "Developer tools").
 */
import type { Content } from '../data/content';
import type { NewGameOptions } from './newGame';
import { newGame } from './newGame';
import type { GameState } from './state';
import { tick } from './tick';

export function runHeadless(content: Content, opts: NewGameOptions, maxHours = content.tuning.clock.maxDays * 24): GameState {
  let state = newGame(content, opts);
  while (!state.ended && state.hour < maxHours) state = tick(state, [], content).state;
  return state;
}
