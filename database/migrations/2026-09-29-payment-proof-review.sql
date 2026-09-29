ALTER TABLE `bookings`
  ADD COLUMN `payment_proof_review` varchar(32) DEFAULT NULL AFTER `receipt_url`,
  ADD COLUMN `payment_proof_fingerprint` char(64) DEFAULT NULL AFTER `payment_proof_review`,
  ADD KEY `idx_bookings_payment_proof_fingerprint` (`payment_proof_fingerprint`);
