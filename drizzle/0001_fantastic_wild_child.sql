CREATE TABLE `query_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`query` text NOT NULL,
	`result` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text,
	`checked_at` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
