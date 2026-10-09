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
// created_at is unix seconds; rows stored before migration 0007 have none and count as old.
export const r2Objects = sqliteTable('r2_objects',{key:text('key').primaryKey(),bytes:integer('bytes').notNull(),createdAt:integer('created_at')});
// Team discussion boards. Authors are player ids and created_at is unix milliseconds. Board text never goes in the club JSON.
export const boardPosts = sqliteTable('board_posts',{id:text('id').primaryKey(),team:text('team').notNull(),author:text('author').notNull(),body:text('body').notNull(),createdAt:integer('created_at').notNull()},t=>[index('idx_board_posts_team').on(t.team,t.createdAt)]);
export const boardComments = sqliteTable('board_comments',{id:text('id').primaryKey(),postId:text('post_id').notNull(),author:text('author').notNull(),body:text('body').notNull(),createdAt:integer('created_at').notNull()},t=>[index('idx_board_comments_post').on(t.postId)]);
// target_id is a post id or a comment id.
export const boardReactions = sqliteTable('board_reactions',{targetId:text('target_id').notNull(),player:text('player').notNull(),emoji:text('emoji').notNull()},t=>[primaryKey({columns:[t.targetId,t.player,t.emoji]})]);
// Every R2 object a board post or comment holds; cleanupStorage counts these keys as referenced.
export const boardImages = sqliteTable('board_images',{key:text('key').primaryKey(),team:text('team').notNull(),postId:text('post_id').notNull(),commentId:text('comment_id'),createdAt:integer('created_at').notNull()},t=>[index('idx_board_images_post').on(t.postId)]);
// Team formations: slots is the JSON list of markers (lib/formation.ts). updated_by is a player id and updated_at is unix milliseconds.
export const formations = sqliteTable('formations',{id:text('id').primaryKey(),team:text('team').notNull(),name:text('name').notNull(),slots:text('slots').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:integer('updated_at').notNull()},t=>[index('idx_formations_team').on(t.team,t.updatedAt)]);
