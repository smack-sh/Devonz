CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`url_id` text,
	`description` text,
	`timestamp` text,
	`metadata` text,
	`user_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_url_id_unique` ON `chats` (`url_id`);--> statement-breakpoint
CREATE INDEX `idx_chats_url_id` ON `chats` (`url_id`);--> statement-breakpoint
CREATE INDEX `idx_chats_user_id` ON `chats` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chats_created_at` ON `chats` (`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`full_message` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_chat_id` ON `messages` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_sort_order` ON `messages` (`chat_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
