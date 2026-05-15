import { integer, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { factions } from './factions.js';

export const narratives = pgTable('narratives', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  factionId: uuid('faction_id').references(() => factions.id),
  confidence: real('confidence'),
  evidenceTweetIds: jsonb('evidence_tweet_ids').$type<string[]>().default([]),
  status: text('status').notNull().default('active'),
  detectedAt: timestamp('detected_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const narrativeSnapshots = pgTable('narrative_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  narrativeId: uuid('narrative_id').references(() => narratives.id).notNull(),
  summary: text('summary').notNull(),
  confidence: real('confidence'),
  tweetVolume: integer('tweet_volume').default(0),
  snapshotAt: timestamp('snapshot_at').defaultNow().notNull(),
});
