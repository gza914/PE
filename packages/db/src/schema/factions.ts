import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const factions = pgTable('factions', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  ideology: text('ideology'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
