/**
 * Advances the simulation by one in-game hour. Pure with respect to its
 * inputs: the same state, commands, and content always give the same result.
 */
import type { Content } from '../data/content';
import { isIncomeHour, isPayrollHour } from './clock';
import { applyCommand, type Command, type Rejection } from './commands';
import { newContext } from './context';
import type { GameState } from './state';
import { pruneOpinions } from './opinion';
import { prunePacts, runPactsDaily } from './pacts';
import { runOperationsDaily, updateOperations } from './operations';
import { updateRequests } from './requests';
import { runAi } from './systems/ai';
import { runCharactersDaily } from './systems/characters';
import { runCombat } from './systems/combat';
import { runDetection } from './systems/detection';
import { payWeeklyPayroll, settleDailyIncome } from './systems/economy';
import { checkEndings } from './systems/endings';
import { runEventsDaily, runScheduledEvents } from './systems/events';
import { runInfowarDaily } from './systems/infowar';
import { runMovement } from './systems/movement';
import { runPulseDaily } from './systems/pulse';
import { runSchemesDaily } from './systems/schemes';
import { runStateForcesDaily } from './systems/stateForces';

export interface TickResult {
  state: GameState;
  rejected: Rejection[];
}

export function tick(prev: GameState, commands: readonly Command[], content: Content): TickResult {
  const state = structuredClone(prev);
  return { state, rejected: advance(state, commands, content) };
}

/**
 * Advances `state` in place by one hour. For callers that own their state
 * (the headless runner); everyone else should use tick().
 */
export function advance(state: GameState, commands: readonly Command[], content: Content): Rejection[] {
  if (state.ended) return [];

  const ctx = newContext(state, content);
  const rejected: Rejection[] = [];
  const apply = (cmds: readonly Command[]) => {
    for (const command of cmds) {
      const reason = applyCommand(ctx, command);
      if (reason !== null) rejected.push({ command, reason });
    }
  };

  apply(commands);

  state.hour += 1;
  const { tuning } = content;

  // Hourly systems, in dependency order.
  runMovement(ctx);
  runDetection(ctx);
  runCombat(ctx);
  runScheduledEvents(ctx);
  updateRequests(ctx);
  updateOperations(ctx);

  if (isIncomeHour(state.hour, tuning)) {
    settleDailyIncome(ctx);
    runPulseDaily(ctx);
    runStateForcesDaily(ctx);
    runCharactersDaily(ctx);
    runSchemesDaily(ctx);
    runInfowarDaily(ctx);
    runEventsDaily(ctx);
    runOperationsDaily(ctx);
    runPactsDaily(ctx);
    pruneOpinions(state);
    prunePacts(state);
  }
  if (isPayrollHour(state.hour, tuning)) payWeeklyPayroll(ctx);

  // AI decides after the world updates, using only what its network saw.
  apply(runAi(ctx));

  checkEndings(ctx);
  return rejected;
}
