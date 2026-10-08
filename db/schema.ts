import { integer, sqliteTable, text, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const club = sqliteTable('club', {id:integer('id').primaryKey(),revision:integer('revision').notNull().default(0),data:text('data').notNull()});
// Eligibility and anonymous choices are deliberately stored in separate tables.
export const receipts = sqliteTable('vote_receipts', {day:text('day').notNull(),player:text('player').notNull()}, t=>[primaryKey({columns:[t.day,t.player]})]);
export const ballots = sqliteTable('ballots', {id:text('id').primaryKey(),day:text('day').notNull(),candidate:text('candidate').notNull()}, t=>[index('idx_ballots_day').on(t.day)]);
// One-time maintenance audit: counts only, never ballot choices or player identities.
export const maintenanceEvents = sqliteTable('maintenance_events',{id:text('id').primaryKey(),dayId:text('day_id').notNull(),date:text('date').notNull(),roundsRemoved:integer('rounds_removed').notNull(),votesRemoved:integer('votes_removed').notNull(),playersBefore:integer('players_before').notNull(),completed:integer('completed').notNull().default(0)});
// Free-tier ledger for R2, written only by lib/r2-budget.ts: operations charged per UTC month, and the size of every stored object.
export const r2Usage = sqliteTable('r2_usage',{month:text('month').primaryKey(),classA:integer('class_a').notNull().default(0),classB:integer('class_b').notNull().default(0)});
// One row while the app changes the Cloudflare Access group, so two changes never overwrite each other (lib/access-sync.ts).
export const accessSyncLock = sqliteTable('access_sync_lock',{id:integer('id').primaryKey(),token:text('token').notNull(),expires:integer('expires').notNull()});
export const r2Objects =sqliteTable('r2_objects',{key:text('key').primaryKey(),bytes:integer('bytes').notNull()});
