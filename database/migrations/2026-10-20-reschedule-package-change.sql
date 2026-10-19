ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `rebooking_requested_package_id` varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_requested_package_name` varchar(191) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_requested_total_amount` decimal(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_additional_payment_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS `rebooking_additional_payment_paid_at` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_additional_payment_paid_by` varchar(191) DEFAULT NULL;
