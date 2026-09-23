CREATE TABLE `maintenance_events` (
 `id` text PRIMARY KEY NOT NULL, `day_id` text NOT NULL, `date` text NOT NULL,
 `rounds_removed` integer NOT NULL, `votes_removed` integer NOT NULL,
 `players_before` integer NOT NULL, `completed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Explicit user request on September 23: reset ALL statistics and votes.
INSERT INTO maintenance_events
SELECT 'reset-all-stats-2026-09-23','all','2026-09-23',
 COALESCE((SELECT sum(json_array_length(value,'$.rounds')) FROM json_each(c.data,'$.days')),0),
 (SELECT count(*) FROM ballots),json_array_length(c.data,'$.players'),0
FROM club c WHERE c.id=1;
--> statement-breakpoint
UPDATE club SET data=json_set(data,'$.days',json(COALESCE((
 SELECT json_group_array(json(json_set(value,'$.rounds',json('[]'),'$.poll','ready')))
 FROM json_each(club.data,'$.days')
),'[]'))),revision=revision+1 WHERE id=1;
--> statement-breakpoint
DELETE FROM ballots;
--> statement-breakpoint
DELETE FROM vote_receipts;
--> statement-breakpoint
UPDATE maintenance_events SET completed=1 WHERE id='reset-all-stats-2026-09-23'
AND NOT EXISTS(SELECT 1 FROM ballots) AND NOT EXISTS(SELECT 1 FROM vote_receipts)
AND NOT EXISTS(SELECT 1 FROM club c,json_each(c.data,'$.days') j WHERE json_array_length(j.value,'$.rounds')<>0 OR json_extract(j.value,'$.poll')<>'ready')
AND EXISTS(SELECT 1 FROM club WHERE id=1 AND json_array_length(data,'$.players')=maintenance_events.players_before);
