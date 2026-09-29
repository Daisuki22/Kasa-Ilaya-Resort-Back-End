ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_provider` varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_amount` decimal(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_reference` varchar(128) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_date` date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `payment_proof_ocr_confidence` decimal(5,2) DEFAULT NULL,
  ADD KEY `idx_bookings_payment_proof_ocr_reference` (`payment_proof_ocr_reference`);
