-- One vote per code becomes a 1-5 score per demo per code.
--
-- The old table carried UNIQUE(code), which SQLite cannot drop in place, so the
-- table is recreated rather than altered. Ballots cast under the old model are
-- discarded with it: a single choice does not translate into six scores, and
-- inventing the five missing ones would put numbers nobody entered into a
-- tally. codes.used_at is reset for the same reason — under the new model it
-- means "this ballot is complete", which none of them now are.
DROP TABLE `votes`;--> statement-breakpoint
CREATE TABLE `votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`demo_id` text NOT NULL,
	`code` text NOT NULL,
	`score` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`demo_id`) REFERENCES `demos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`code`) REFERENCES `codes`(`code`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `votes_score_range` CHECK(`score` between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_code_demo_unique` ON `votes` (`code`,`demo_id`);--> statement-breakpoint
CREATE INDEX `votes_event_demo_idx` ON `votes` (`event_id`,`demo_id`);--> statement-breakpoint
UPDATE `codes` SET `used_at` = NULL;
