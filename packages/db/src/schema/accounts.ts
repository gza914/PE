import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { factions } from './factions.js';

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  xHandle: text('x_handle').notNull().unique(),
  xUserId: text('x_user_id').unique(),
  displayName: text('display_name'),
  factionId: uuid('faction_id').references(() => factions.id),
  notes: text('notes'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
