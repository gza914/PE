import { useMemo } from 'react';
import { groupOf } from '../sim/crews';
import { planOptions, type Route } from '../sim/routing';
import type { RoutePreference } from '../sim/state';
import { useGame } from './store';
import { playerNetwork } from './util';

export const PREFERENCES: RoutePreference[] = ['fastest', 'balanced', 'safest'];

/** The three candidate routes for the crew being planned, using only the player's knowledge. */
export function usePlanOptions(): Record<RoutePreference, Route | null> | null {
  const content = useGame((s) => s.content);
  const game = useGame((s) => s.game);
  const plan = useGame((s) => s.plan);
  return useMemo(() => {
    if (!game || !plan?.destination) return null;
    const crew = game.crews[plan.crew];
    if (!crew) return null;
    return planOptions(game, content, {
      crews: groupOf(game, crew),
      from: crew.location,
      destination: plan.destination,
      waypoints: plan.waypoints,
      departHour: game.hour,
      viewer: playerNetwork(game),
    });
  }, [content, game, plan]);
}
