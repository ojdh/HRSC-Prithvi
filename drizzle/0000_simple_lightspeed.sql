CREATE TABLE `ballots` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`candidate` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ballots_day` ON `ballots` (`day`);--> statement-breakpoint
CREATE TABLE `club` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vote_receipts` (
	`day` text NOT NULL,
	`player` text NOT NULL,
	PRIMARY KEY(`day`, `player`)
);
