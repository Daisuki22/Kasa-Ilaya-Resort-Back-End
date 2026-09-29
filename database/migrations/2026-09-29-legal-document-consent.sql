CREATE TABLE IF NOT EXISTS `legal_documents` (
  `id` varchar(64) NOT NULL,
  `created_date` datetime NOT NULL,
  `updated_date` datetime NOT NULL,
  `document_type` enum('terms','privacy') NOT NULL,
  `title` varchar(191) NOT NULL,
  `content` longtext NOT NULL,
  `version` varchar(32) NOT NULL,
  `status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
  `created_by` varchar(64) DEFAULT NULL,
  `published_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_legal_document_version` (`document_type`,`version`),
  KEY `idx_legal_documents_published` (`document_type`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `bookings`
  ADD COLUMN IF NOT EXISTS `customer_user_id` varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `terms_document_id` varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `terms_version` varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `terms_accepted` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `privacy_document_id` varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `privacy_version` varchar(32) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `privacy_acknowledged` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `privacy_consent` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `legal_accepted_at` datetime DEFAULT NULL;

INSERT INTO `legal_documents`
  (`id`,`created_date`,`updated_date`,`document_type`,`title`,`content`,`version`,`status`,`created_by`,`published_at`)
SELECT 'legal-terms-initial-v1',NOW(),NOW(),'terms',COALESCE(NULLIF(`terms_title`,''),'Terms & Conditions'),`terms_content`,'1.0','published',NULL,NOW()
FROM `site_settings`
WHERE `terms_content` IS NOT NULL AND TRIM(`terms_content`)<>''
  AND NOT EXISTS (SELECT 1 FROM `legal_documents` WHERE `document_type`='terms')
LIMIT 1;

INSERT INTO `legal_documents`
  (`id`,`created_date`,`updated_date`,`document_type`,`title`,`content`,`version`,`status`,`created_by`,`published_at`)
SELECT 'legal-privacy-initial-v1',NOW(),NOW(),'privacy','Privacy Notice',
'Information collected\nWhen you make a booking, the resort collects the name, email address, phone number, reservation details, guest count, messages you provide, and uploaded payment proof. Account information may also be used to associate the reservation with your customer account.\n\nWhy the information is used\nThe information is used to create and manage your reservation, check availability, communicate with you about the booking, review submitted payment proof, provide customer support, and maintain business and transaction records.\n\nAccess and sharing\nAuthorized resort staff may access information needed to manage your reservation. The system may rely on service providers for hosting, storage, communications, and technical operations; those providers may process information only as needed to provide their services. Information may also be disclosed when required by law.\n\nRetention\nBooking and payment records are kept for as long as reasonably needed to manage the reservation, resolve related issues, and meet applicable recordkeeping obligations. Contact the resort to ask about a particular record.\n\nSecurity\nThe resort uses account access controls and technical safeguards intended to protect stored information. No online system can guarantee absolute security.\n\nYour choices and requests\nYou may contact the resort to ask about access to or correction of your personal information, or to raise a concern about its handling. Requests are reviewed subject to identity checks and applicable recordkeeping requirements.\n\nContact\nKasa Ilaya Resort & Event Place\nEmail: info@kasailaya.com\nPhone: +63 905 386 9255',
'1.0','published',NULL,NOW()
WHERE NOT EXISTS (SELECT 1 FROM `legal_documents` WHERE `document_type`='privacy');
