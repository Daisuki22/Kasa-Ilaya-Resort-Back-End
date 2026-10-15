ALTER TABLE `notifications`
  ADD COLUMN IF NOT EXISTS `actor_name` varchar(191) DEFAULT NULL AFTER `entity_id`,
  ADD COLUMN IF NOT EXISTS `actor_profile_image_url` varchar(1024) DEFAULT NULL AFTER `actor_name`;

UPDATE `notifications` n
LEFT JOIN `bookings` b ON b.`id`=n.`entity_id` AND n.`entity_type`='Booking'
LEFT JOIN `users` u ON LOWER(u.`email`)=LOWER(b.`customer_email`)
SET n.`actor_name`=COALESCE(u.`full_name`,b.`customer_name`,'Guest'),
    n.`actor_profile_image_url`=u.`profile_image_url`
WHERE n.`entity_type`='Booking' AND n.`actor_name` IS NULL AND n.`entity_id` IS NOT NULL;
