import { integer, sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const club = sqliteTable('club', {id:integer('id').primaryKey(),revision:integer('revision').notNull().default(0),data:text('data').notNull()});
// Eligibility and anonymous choices are deliberately stored in separate tables.
export const receipts = sqliteTable('vote_receipts', {day:text('day').notNull(),player:text('player').notNull()}, t=>[primaryKey({columns:[t.day,t.player]})]);
export const ballots = sqliteTable('ballots', {id:text('id').primaryKey(),day:text('day').notNull(),candidate:text('candidate').notNull()}, t=>[index('idx_ballots_day').on(t.day)]);
// One-time maintenance audit: counts only, never ballot choices or player identities.
export const maintenanceEvents = sqliteTable('maintenance_events',{id:text('id').primaryKey(),dayId:text('day_id').notNull(),date:text('date').notNull(),roundsRemoved:integer('rounds_removed').notNull(),votesRemoved:integer('votes_removed').notNull(),playersBefore:integer('players_before').notNull(),completed:integer('completed').notNull().default(0)});
