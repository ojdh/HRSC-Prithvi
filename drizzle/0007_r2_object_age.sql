-- When each R2 object was stored (unix seconds), so the daily clean-up never removes an upload still in flight. SQLite cannot add a column with a unixepoch() default, so lib/r2-budget.ts sets it; rows stored before this migration stay NULL and count as old.
ALTER TABLE `r2_objects` ADD `created_at` integer;
