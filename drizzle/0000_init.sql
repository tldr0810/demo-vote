CREATE TABLE `codes` (
	`code` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`batch` text NOT NULL,
	`activated_at` text,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `codes_event_idx` ON `codes` (`event_id`);--> statement-breakpoint
CREATE TABLE `demos` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`slot` integer NOT NULL,
	`name` text NOT NULL,
	`team` text DEFAULT '' NOT NULL,
	`blurb` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demos_event_slot_unique` ON `demos` (`event_id`,`slot`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`window_seconds` integer DEFAULT 3600 NOT NULL,
	`opened_at` text,
	`closes_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`demo_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`code`) REFERENCES `codes`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_code_unique` ON `votes` (`code`);--> statement-breakpoint
CREATE INDEX `votes_event_demo_idx` ON `votes` (`event_id`,`demo_id`);