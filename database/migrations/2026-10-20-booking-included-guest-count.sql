ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `included_guest_count` int NOT NULL DEFAULT 1 AFTER `guest_count`;
