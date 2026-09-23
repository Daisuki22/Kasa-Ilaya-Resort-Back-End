# Database

Use the existing Kasa Ilaya TiDB schema file to create the database/tables.

The schema contains the tables used by this Node backend, including:

- users
- bookings
- packages
- reviews
- inquiries
- inquiry_messages
- lost_item_reports
- found_items
- payment_qr_codes
- resort_rules
- site_settings
- upcoming_schedules
- activity_logs
- mail_logs
- password_reset_tokens
- pending_registrations
- registration_otps

The schema file is intentionally not duplicated here because the existing project already has `kasa_ilaya_resort_updated.sql`.

Import it into TiDB Cloud once. Do not put database passwords in SQL files.
