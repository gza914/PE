/** The content shipped with the game, bundled by Vite (and Vitest). */
import map from './map.json';
import roads from './roads.json';
import colonias from './colonias.json';
import factions from './factions.json';
import traits from './traits.json';
import characters from './characters.json';
import messages from './messages.json';
import tuning from './tuning.json';
import { loadContent, type Content, type RawContent } from './content';

const eventModules = import.meta.glob<unknown>('./events/*.json', { eager: true, import: 'default' });

export function bundledRawContent(): RawContent {
  const events: Record<string, unknown> = {};
  for (const [path, data] of Object.entries(eventModules)) events[path.replace('./', '')] = data;
  return { map, roads, colonias, factions, traits, characters, messages, events, tuning };
}

export function bundledContent(): Content {
  return loadContent(bundledRawContent());
}
