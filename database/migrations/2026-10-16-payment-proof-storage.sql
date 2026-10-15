CREATE TABLE IF NOT EXISTS `payment_proof_uploads` (
  `file_url` varchar(255) NOT NULL,
  `mime_type` varchar(32) NOT NULL,
  `image_data` mediumblob NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`file_url`),
  KEY `idx_payment_proof_uploads_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
