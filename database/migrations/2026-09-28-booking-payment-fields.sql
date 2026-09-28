-- Booking submissions persist these fields independently; existing rows remain unchanged.
ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `payment_type` varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `payment_amount_due` decimal(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `payment_mode` varchar(191) DEFAULT NULL;
