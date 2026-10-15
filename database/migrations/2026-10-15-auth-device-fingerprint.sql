ALTER TABLE `auth_sessions`
  ADD COLUMN IF NOT EXISTS `device_fingerprint` char(64) DEFAULT NULL AFTER `user_agent`;
