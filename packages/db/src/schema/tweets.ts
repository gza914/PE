import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { accounts } from './accounts.js';

export const tweets = pgTable('tweets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tweetId: text('tweet_id').notNull().unique(),
  accountId: uuid('account_id').references(() => accounts.id),
  content: text('content').notNull(),
  tweetedAt: timestamp('tweeted_at').notNull(),
  likeCount: integer('like_count').default(0),
  retweetCount: integer('retweet_count').default(0),
  replyCount: integer('reply_count').default(0),
  raw: jsonb('raw'),
  ingestedAt: timestamp('ingested_at').defaultNow().notNull(),
});
