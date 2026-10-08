CREATE TABLE `r2_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `r2_usage` (
	`month` text PRIMARY KEY NOT NULL,
	`class_a` integer DEFAULT 0 NOT NULL,
	`class_b` integer DEFAULT 0 NOT NULL
);
