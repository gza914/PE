#!/usr/bin/env node
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const factionsPath = resolve(ROOT, 'taxonomy/factions.yaml');
const accountsPath = resolve(ROOT, 'taxonomy/accounts.yaml');

let errors = 0;

function fail(msg) {
  console.error(`  ERROR: ${msg}`);
  errors++;
}

const factions = parse(readFileSync(factionsPath, 'utf8'));
const accounts = parse(readFileSync(accountsPath, 'utf8'));

console.log('Validating taxonomy...');

const factionSlugs = new Set();
for (const f of factions) {
  if (!f.slug) fail(`Faction missing slug: ${JSON.stringify(f)}`);
  if (!f.name) fail(`Faction missing name: ${f.slug}`);
  if (factionSlugs.has(f.slug)) fail(`Duplicate faction slug: ${f.slug}`);
  factionSlugs.add(f.slug);
}

const handles = new Set();
for (const a of accounts) {
  if (!a.handle) fail(`Account missing handle: ${JSON.stringify(a)}`);
  if (!a.faction) fail(`Account @${a.handle} missing faction`);
  if (!factionSlugs.has(a.faction)) fail(`Account @${a.handle} references unknown faction "${a.faction}"`);
  if (handles.has(a.handle)) fail(`Duplicate account handle: @${a.handle}`);
  handles.add(a.handle);
}

if (errors > 0) {
  console.error(`\nTaxonomy validation failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log(`OK — ${factions.length} factions, ${accounts.length} accounts.`);
}
