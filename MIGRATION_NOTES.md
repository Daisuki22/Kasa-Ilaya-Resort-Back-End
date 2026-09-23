# PHP -> Node.js replacement

Converted from the uploaded PHP backend modules:
- api/auth.php
- api/entities.php
- api/inquiries.php
- api/integrations.php
- api/health.php
- api/bootstrap.php / db_connection.php configuration behavior

The Node server preserves the existing PHP-compatible URLs so the deployed Vercel frontend can keep calling them:
`/api/auth.php`, `/api/entities.php`, `/api/inquiries.php`, `/api/integrations.php`.

It also exposes clean Node routes without `.php`.

Important: the PHP session system is replaced with JWT in an HTTP-only cookie and Bearer-token support. OTP and password reset records use the existing TiDB tables. SMTP is handled by Nodemailer. TiDB uses TLS.

Before Render deployment, run `npm install` in this directory once to create `package-lock.json`, commit it, then Render can use `npm ci`.
