CREATE TABLE `drives` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`drive_uuid` text,
	`size_bytes` integer,
	`free_bytes` integer,
	`last_scanned` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drives_label_unique` ON `drives` (`label`);--> statement-breakpoint
CREATE UNIQUE INDEX `drives_drive_uuid_unique` ON `drives` (`drive_uuid`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`xxh3` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`first_seen` text NOT NULL,
	`last_seen` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_identity` ON `files` (`xxh3`,`size_bytes`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_id` integer NOT NULL,
	`drive_id` integer NOT NULL,
	`path_on_drive` text NOT NULL,
	`verification` text NOT NULL,
	`mtime` integer,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`drive_id`) REFERENCES `drives`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_file_drive` ON `locations` (`file_id`,`drive_id`);--> statement-breakpoint
CREATE TABLE `nas_hash_cache` (
	`path` text PRIMARY KEY NOT NULL,
	`size_bytes` integer NOT NULL,
	`mtime` integer NOT NULL,
	`xxh3` text NOT NULL,
	`cached_at` text NOT NULL
);
