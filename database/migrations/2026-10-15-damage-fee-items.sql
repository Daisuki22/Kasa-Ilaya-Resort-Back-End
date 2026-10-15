ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `additional_fee_items` JSON DEFAULT NULL;
