ALTER TABLE `activity_logs`
  ADD COLUMN IF NOT EXISTS `actor_role` varchar(32) DEFAULT NULL AFTER `user_name`;

UPDATE `activity_logs` AS `logs`
LEFT JOIN `users` AS `accounts`
  ON LOWER(`accounts`.`email`)=LOWER(`logs`.`user_email`)
SET `logs`.`actor_role`=COALESCE(NULLIF(`accounts`.`role`,''),NULLIF(`accounts`.`app_role`,''),'guest')
WHERE `logs`.`actor_role` IS NULL;
