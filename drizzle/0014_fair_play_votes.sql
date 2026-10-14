CREATE TABLE `fair_play_ballots` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`candidate` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fair_play_ballots_day` ON `fair_play_ballots` (`day`);--> statement-breakpoint
CREATE TABLE `fair_play_receipts` (
	`day` text NOT NULL,
	`player` text NOT NULL,
	PRIMARY KEY(`day`, `player`)
);
