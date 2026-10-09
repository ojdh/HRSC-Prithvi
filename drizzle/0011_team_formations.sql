CREATE TABLE `formations` (
	`id` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`name` text NOT NULL,
	`slots` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_formations_team` ON `formations` (`team`,`updated_at`);