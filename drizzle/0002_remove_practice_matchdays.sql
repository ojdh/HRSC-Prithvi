-- No official games have been played. Remove practice dates, preserving players.
INSERT INTO maintenance_events
SELECT 'remove-practice-days-2026-09-23','all','2026-09-23',
 COALESCE((SELECT sum(json_array_length(value,'$.rounds')) FROM json_each(c.data,'$.days')),0),
 (SELECT count(*) FROM ballots),json_array_length(c.data,'$.players'),0
FROM club c WHERE c.id=1;
--> statement-breakpoint
UPDATE club SET data=json_set(data,'$.days',json('[]')),revision=revision+1 WHERE id=1;
--> statement-breakpoint
DELETE FROM ballots;
--> statement-breakpoint
DELETE FROM vote_receipts;
--> statement-breakpoint
UPDATE maintenance_events SET completed=1 WHERE id='remove-practice-days-2026-09-23'
AND EXISTS(SELECT 1 FROM club WHERE id=1 AND json_array_length(data,'$.days')=0
AND json_array_length(data,'$.players')=maintenance_events.players_before);
