CREATE TABLE `notifications` (
  `id` varchar(64) NOT NULL,
  `created_date` datetime NOT NULL,
  `user_email` varchar(191) NOT NULL,
  `event_key` varchar(191) NOT NULL,
  `title` varchar(191) NOT NULL,
  `description` text NOT NULL,
  `link` varchar(255) DEFAULT NULL,
  `entity_type` varchar(64) NOT NULL DEFAULT 'Booking',
  `entity_id` varchar(64) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notifications_user_event` (`user_email`,`event_key`),
  KEY `idx_notifications_user_unread` (`user_email`,`is_read`,`created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
