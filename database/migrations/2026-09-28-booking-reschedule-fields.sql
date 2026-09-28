-- Existing production databases may predate the reschedule fields in the full schema.
ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `rebooking_status` enum('none','pending','approved','declined') NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS `rebooking_original_date` date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_requested_date` date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_reason` text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_requested_at` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_resolved_at` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_resolution_note` text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `rebooking_count` int(11) NOT NULL DEFAULT 0;
