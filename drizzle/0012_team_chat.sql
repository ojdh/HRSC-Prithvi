CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_team` ON `chat_messages` (`team`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_state` (
	`team` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_message_at` integer
);
