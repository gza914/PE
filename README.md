# Cartel Conquest

A single-player, real-time-with-pause grand strategy game set in a Sinaloa
cartel civil war, built as a browser game in TypeScript. The full design is in
[docs/GDD.md](docs/GDD.md).

**Status:** phase 1 of the roadmap (logistics and detection) is playable.
Route planning, movement, sync arrival, escorts, split/merge, halcón
detection, patrols, drones, fog of war, and the intel ledger work end to end,
with scripted AI supply traffic on the roads. Combat, economy, characters, the
State, info war, and events come in later phases. See the build log at the
end of the GDD.

## Commands

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest: content validation, determinism, save/load, headless run
npm run typecheck
npm run build
```

In game: `Space` pauses, `1`–`5` set speed, `Esc` cancels route planning.
Select a crew, press Move, click a destination, pick a route. Click a road
to launch a drone. The top bar has map overlays and a debug fog toggle.

## Layout

```
docs/GDD.md          game design document (source of truth)
src/data/            content JSON + Zod schemas (schemas.ts) + loader (content.ts)
  tuning.json        every balance number
  events/*.json      one event per file
src/sim/             pure, deterministic simulation core (no DOM)
  state.ts           the single serializable GameState
  tick.ts            advances one in-game hour
  commands.ts        the only way to change state from outside
  rng.ts             seeded, serializable PRNG
  routing.ts         route planner (Fastest / Balanced / Safest, waypoints)
  signature.ts       signature and detection math
  knowledge.ts       what a network knows (UI and AI read through this)
  systems/           movement, detection, ai (live); combat, economy, ... (stubs)
src/ui/              React + Zustand shell, SVG maps
tests/               Vitest unit tests and headless campaign runs
```

## Content

All content is first-draft data written for the game, ready for review:
48 map nodes and 74 roads, 16 Culiacán colonias, 31 fictional characters
(2 heads, 24 lieutenants, 5 crew leaders), 40 message templates, and 44
events. Characters are invented composites; their names deliberately avoid
real people. The scripts that generated the drafts are not needed to edit
them: edit the JSON directly and the loader validates it.
