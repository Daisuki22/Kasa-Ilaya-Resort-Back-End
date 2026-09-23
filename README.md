# Kasa Ilaya Resort — Node.js production backend

This replaces the PHP API with Node.js/Express and keeps the old `.php` API paths as compatibility aliases.

## Render
- Root Directory: `backend` (if this folder is copied into your repo as `backend`)
- Build Command: `npm ci`
- Start Command: `npm start`

## Required Render variables
`NODE_ENV`, `PORT`, `FRONTEND_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `KASA_DB_HOST`, `KASA_DB_PORT`, `KASA_DB_NAME`, `KASA_DB_USER`, `KASA_DB_PASS`.

Optional SMTP: `KASA_MAIL_ENABLED`, `KASA_SMTP_HOST`, `KASA_SMTP_PORT`, `KASA_SMTP_USER`, `KASA_SMTP_PASS`, `KASA_MAIL_FROM_EMAIL`, `KASA_MAIL_FROM_NAME`, `KASA_ADMIN_NOTIFICATION_EMAIL`.

## Existing frontend compatibility
These remain available:
- `/api/auth.php?action=...`
- `/api/entities.php?entity=...`
- `/api/inquiries.php?action=...`
- `/api/integrations.php?action=...`

Clean Node equivalents are also available at `/api/auth`, `/api/entities`, `/api/inquiries`, `/api/integrations`.

Do not commit `.env`, passwords, JWT secrets, or SMTP credentials.
