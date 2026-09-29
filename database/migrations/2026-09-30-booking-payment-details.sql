-- Keep each ADD COLUMN in its own statement. TiDB validates the original
-- schema for a multi-column ALTER, so `AFTER` references to columns added in
-- that same ALTER can make the entire migration fail.
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_review` varchar(32) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_fingerprint` char(64) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_ocr_provider` varchar(32) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_ocr_amount` decimal(10,2) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_ocr_reference` varchar(128) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_ocr_date` date DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_proof_ocr_confidence` decimal(5,2) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `additional_fee_paid_at` datetime DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `additional_fee_paid_by` varchar(64) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_number` varchar(64) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `payment_reference_number` varchar(128) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `approved_by` varchar(64) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `approved_at` datetime DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `rejected_by` varchar(64) DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `rejected_at` datetime DEFAULT NULL;
ALTER TABLE `bookings` ADD COLUMN IF NOT EXISTS `rejection_reason` text DEFAULT NULL;

ALTER TABLE `bookings`
  MODIFY COLUMN `status` enum('pending','confirmed','cancelled','completed','archived','rejected') NOT NULL DEFAULT 'pending';
