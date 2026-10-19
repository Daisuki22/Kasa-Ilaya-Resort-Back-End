ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `official_receipt_number` varchar(64) DEFAULT NULL AFTER `booking_reference`;
