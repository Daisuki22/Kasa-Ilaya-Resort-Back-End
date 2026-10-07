# Kasa Ilaya Resort — Node.js production backend

Node.js/Express API. It keeps the `.php` API paths used by the existing frontend as compatibility aliases.

## Render
- Root Directory: `backend` (if this folder is copied into your repo as `backend`)
- Build Command: `npm ci`
- Start Command: `npm start`

## Booking schema on TiDB
Before deploying booking/payment changes to an existing TiDB database, apply
`database/migrations/2026-09-30-booking-payment-details.sql` and
`database/migrations/2026-09-29-legal-document-consent.sql`. The booking/payment
migration adds missing proof-review/OCR, payment number/reference, and approval
audit columns used by `POST /api/entities.php?entity=Booking`; it is safe to
rerun on a partially migrated database. The full
`database/kasa_ilaya_resort_updated.sql` schema includes these fields for new
database imports.

## Required Render variables
`NODE_ENV`, `PORT`, `FRONTEND_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `KASA_DB_HOST`, `KASA_DB_PORT`, `KASA_DB_NAME`, `KASA_DB_USER`, `KASA_DB_PASS`. Local development uses the same database variables in `backend/.env`; Vite proxies `/api` to `http://localhost:10000`.

Optional SMTP: `KASA_MAIL_ENABLED`, `KASA_SMTP_HOST`, `KASA_SMTP_PORT`, `KASA_SMTP_USER`, `KASA_SMTP_PASS`, `KASA_MAIL_FROM_EMAIL`, `KASA_MAIL_FROM_NAME`, `KASA_ADMIN_NOTIFICATION_EMAIL`.

### Temporary OTP for local development
When SMTP is unavailable, run the backend locally with `NODE_ENV=development`.
Registration and password-reset flows then use `123456` by default, and the
frontend shows/fills in that temporary code. You can override it locally with
`KASA_SAMPLE_REGISTRATION_OTP` and `KASA_SAMPLE_RESET_OTP` (each must be six
digits). These fallback codes are disabled whenever `NODE_ENV=production`, so
they are not returned by the public production API. Production account recovery
still requires a working email delivery service.

### Brevo SMTP setup
The mail service is configured to use Brevo's SMTP relay (`smtp-relay.brevo.com`). Use port `2525` on Render's free web-service plan because Render blocks outbound SMTP ports `25`, `465`, and `587` there. Brevo supports port `2525`; the backend requires STARTTLS. Set these values in `backend/.env` for local use and in the Render service environment for production:

```env
KASA_MAIL_ENABLED=true
KASA_SMTP_HOST=smtp-relay.brevo.com
KASA_SMTP_PORT=2525
KASA_SMTP_USER=<Brevo SMTP login>
KASA_SMTP_PASS=<Brevo SMTP key>
KASA_MAIL_FROM_EMAIL=<address verified in Brevo>
KASA_MAIL_FROM_NAME=Kasa Ilaya Resort
```

In Brevo, use the SMTP login and SMTP key shown under SMTP & API; the SMTP key is not an API key. The sender address must be verified in Brevo. Keep the login and key in environment variables, never in source control.

Brevo also requires domain-authentication records. The current Brevo setup for `kasailaya.com` shows:

| Type | Name | Value |
| --- | --- | --- |
| TXT | `@` | `brevo-code:252580074fb03c06d612fb53dc4de8b0` |
| CNAME | `brevo1._domainkey` | `b1.kasailaya-com.dkim.brevo.com` |
| CNAME | `brevo2._domainkey` | `b2.kasailaya-com.dkim.brevo.com` |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |

Add these records in the DNS control panel that manages `kasailaya.com`, then wait for DNS propagation and recheck the domain in Brevo. Some DNS panels append the domain automatically, so enter only the record name shown above when that is how the panel works. If a `_dmarc` TXT record already exists, edit/merge that record instead of creating a duplicate. These values are specific to the current Brevo domain setup; use the dashboard's latest values if they change.

## Upload storage on Render
New uploads are written to `KASA_UPLOADS_DIR` when set, otherwise to
`backend/uploads`. Static serving checks that directory first, then the
versioned public recovery assets in `backend/public/uploads`.

Render's filesystem is not persistent without a mounted disk. Attach a persistent
disk to the service and set `KASA_UPLOADS_DIR` to that disk's mount path plus an
`uploads` directory (for example `/var/data/kasa-ilaya/uploads`) to preserve new
uploads across restarts and deploys. The public recovery assets are safe to ship
with the backend; private booking receipts and profile images are not included.

## Existing frontend compatibility
These remain available:
- `/api/auth.php?action=...`
- `/api/entities.php?entity=...`
- `/api/inquiries.php?action=...`
- `/api/integrations.php?action=...`

Clean Node equivalents are also available at `/api/auth`, `/api/entities`, `/api/inquiries`, `/api/integrations`.

Do not commit `.env`, passwords, JWT secrets, or SMTP credentials.
