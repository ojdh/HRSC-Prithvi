CREATE TABLE `board_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_board_comments_post` ON `board_comments` (`post_id`);--> statement-breakpoint
CREATE TABLE `board_images` (
	`key` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`post_id` text NOT NULL,
	`comment_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_board_images_post` ON `board_images` (`post_id`);--> statement-breakpoint
CREATE TABLE `board_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`team` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_board_posts_team` ON `board_posts` (`team`,`created_at`);--> statement-breakpoint
CREATE TABLE `board_reactions` (
	`target_id` text NOT NULL,
	`player` text NOT NULL,
	`emoji` text NOT NULL,
	PRIMARY KEY(`target_id`, `player`, `emoji`)
);
