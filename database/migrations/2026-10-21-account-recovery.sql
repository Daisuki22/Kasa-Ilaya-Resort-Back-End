CREATE TABLE IF NOT EXISTS `account_recovery_requests` (
  `id` varchar(64) NOT NULL PRIMARY KEY,
  `user_id` varchar(64) NOT NULL,
  `old_email` varchar(191) NOT NULL,
  `requested_email` varchar(191) NOT NULL,
  `full_name` varchar(191) NOT NULL,
  `phone` varchar(32) NOT NULL,
  `booking_reference` varchar(64) DEFAULT NULL,
  `reason` varchar(1000) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `reviewed_by` varchar(64) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `review_note` varchar(1000) DEFAULT NULL,
  `created_date` datetime NOT NULL,
  `updated_date` datetime NOT NULL,
  KEY `idx_account_recovery_status_created` (`status`, `created_date`),
  KEY `idx_account_recovery_user_created` (`user_id`, `created_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `password_reset_tokens`
  ADD COLUMN IF NOT EXISTS `purpose` varchar(32) NOT NULL DEFAULT 'reset_authorization' AFTER `token_hash`;

ALTER TABLE `password_reset_tokens`
  ADD COLUMN IF NOT EXISTS `attempts` int NOT NULL DEFAULT 0 AFTER `purpose`;

ALTER TABLE `password_reset_tokens`
  ADD COLUMN IF NOT EXISTS `recovery_request_id` varchar(64) DEFAULT NULL AFTER `attempts`;

