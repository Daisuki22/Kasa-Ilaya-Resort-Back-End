ALTER TABLE `bookings`
  MODIFY COLUMN `payment_status` enum('unpaid','pending_verification','paid','declined') NOT NULL DEFAULT 'unpaid';
