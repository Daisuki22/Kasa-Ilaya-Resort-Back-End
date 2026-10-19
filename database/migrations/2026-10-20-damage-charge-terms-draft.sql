INSERT INTO `legal_documents`
  (`id`, `created_date`, `updated_date`, `document_type`, `title`, `content`, `version`, `status`, `created_by`, `published_at`)
SELECT
  'legal-terms-damage-fees-draft',
  NOW(),
  NOW(),
  'terms',
  `title`,
  CONCAT(
    `content`,
    '\n\nProperty Damage and Missing Items\n\n',
    'Guests are responsible for damage to, or loss of, resort property caused by their party. The resort will assess each affected item separately. The guest will receive an itemized charge showing the specific peso amount for each item, based on its documented repair or replacement cost, before payment is requested. Staff must record the affected item, amount, and supporting notes in the reservation.'
  ),
  '2.0',
  'draft',
  NULL,
  NULL
FROM `legal_documents`
WHERE `document_type`='terms' AND `status`='published'
  AND NOT EXISTS (
    SELECT 1 FROM `legal_documents`
    WHERE `document_type`='terms' AND `version`='2.0'
  )
ORDER BY `published_at` DESC
LIMIT 1;
