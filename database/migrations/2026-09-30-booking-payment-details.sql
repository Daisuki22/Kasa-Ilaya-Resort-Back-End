ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `payment_proof_review` varchar(32) DEFAULT NULL AFTER `receipt_url`,
  ADD COLUMN IF NOT EXISTS `payment_proof_fingerprint` char(64) DEFAULT NULL AFTER `payment_proof_review`,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_provider` varchar(32) DEFAULT NULL AFTER `payment_proof_fingerprint`,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_amount` decimal(10,2) DEFAULT NULL AFTER `payment_proof_ocr_provider`,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_reference` varchar(128) DEFAULT NULL AFTER `payment_proof_ocr_amount`,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_date` date DEFAULT NULL AFTER `payment_proof_ocr_reference`,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_confidence` decimal(5,2) DEFAULT NULL AFTER `payment_proof_ocr_date`,
  ADD COLUMN IF NOT EXISTS `additional_fee_paid_at` datetime DEFAULT NULL AFTER `additional_fee_status`,
  ADD COLUMN IF NOT EXISTS `additional_fee_paid_by` varchar(64) DEFAULT NULL AFTER `additional_fee_paid_at`,
  ADD COLUMN IF NOT EXISTS `payment_number` varchar(64) DEFAULT NULL AFTER `payment_mode`,
  ADD COLUMN IF NOT EXISTS `payment_reference_number` varchar(128) DEFAULT NULL AFTER `payment_number`,
  ADD COLUMN IF NOT EXISTS `approved_by` varchar(64) DEFAULT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `approved_at` datetime DEFAULT NULL AFTER `approved_by`,
  ADD COLUMN IF NOT EXISTS `rejected_by` varchar(64) DEFAULT NULL AFTER `approved_at`,
  ADD COLUMN IF NOT EXISTS `rejected_at` datetime DEFAULT NULL AFTER `rejected_by`,
  ADD COLUMN IF NOT EXISTS `rejection_reason` text DEFAULT NULL AFTER `rejected_at`;

ALTER TABLE `bookings`
  MODIFY COLUMN `status` enum('pending','confirmed','cancelled','completed','archived','rejected') NOT NULL DEFAULT 'pending';
