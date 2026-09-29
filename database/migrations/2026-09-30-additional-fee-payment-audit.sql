ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `additional_fee_paid_at` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `additional_fee_paid_by` varchar(64) DEFAULT NULL;
