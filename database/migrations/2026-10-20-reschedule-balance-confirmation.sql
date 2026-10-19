ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `rebooking_additional_payment_paid_at` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_additional_payment_paid_by` varchar(191) DEFAULT NULL;
