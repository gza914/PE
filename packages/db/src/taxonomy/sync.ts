import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'yaml';
import { db } from '../client.js';
import { accounts, factions } from '../schema/index.js';

const TAXONOMY_ROOT = resolve(process.cwd(), '../../taxonomy');

interface FactionYaml {
  slug: string;
  name: string;
  description?: string;
  ideology?: string;
}

interface AccountYaml {
  handle: string;
  faction: string;
  display_name?: string;
  notes?: string;
}

async function sync() {
  const factionsData: FactionYaml[] = parse(
    readFileSync(resolve(TAXONOMY_ROOT, 'factions.yaml'), 'utf8')
  );
  const accountsData: AccountYaml[] = parse(
    readFileSync(resolve(TAXONOMY_ROOT, 'accounts.yaml'), 'utf8')
  );

  console.log(`Syncing ${factionsData.length} factions, ${accountsData.length} accounts...`);

  for (const f of factionsData) {
    await db
      .insert(factions)
      .values({ slug: f.slug, name: f.name, description: f.description, ideology: f.ideology })
      .onConflictDoUpdate({ target: factions.slug, set: { name: f.name, description: f.description, ideology: f.ideology } });
  }

  const factionRows = await db.select().from(factions);
  const factionBySlug = Object.fromEntries(factionRows.map((f) => [f.slug, f]));

  for (const a of accountsData) {
    const faction = factionBySlug[a.faction];
    if (!faction) throw new Error(`Unknown faction "${a.faction}" for account @${a.handle}`);
    await db
      .insert(accounts)
      .values({ xHandle: a.handle, displayName: a.display_name, factionId: faction.id, notes: a.notes })
      .onConflictDoUpdate({ target: accounts.xHandle, set: { displayName: a.display_name, factionId: faction.id, notes: a.notes } });
  }

  console.log('Taxonomy sync complete.');
  process.exit(0);
}

sync().catch((err) => { console.error(err); process.exit(1); });
