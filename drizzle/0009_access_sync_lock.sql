CREATE TABLE `access_sync_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL
);
