CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`product_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `source`, `product_id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `products` (
	`generation` text NOT NULL,
	`source` text NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`search` text NOT NULL,
	`data` text NOT NULL,
	PRIMARY KEY(`generation`, `source`, `id`)
);
--> statement-breakpoint
CREATE INDEX `product_listing` ON `products` (`generation`,`source`,`name`);--> statement-breakpoint
CREATE TABLE `job_seen` (
	`job` text NOT NULL,
	`shard` text NOT NULL,
	`product` text NOT NULL,
	PRIMARY KEY(`job`, `shard`, `product`)
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`status` text NOT NULL,
	`coverage` text NOT NULL,
	`checked_at` text NOT NULL,
	`message` text NOT NULL
);
