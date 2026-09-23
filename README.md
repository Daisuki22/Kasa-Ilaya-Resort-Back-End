# Kasa Ilaya Resort — Node.js Backend

Node.js + Express + MySQL2 backend for Render and TiDB Cloud.

## Architecture

Vercel frontend → Render Node.js API → TiDB Cloud

No Docker is required.

## Local setup

1. Copy `.env.example` to `.env`.
2. Put your TiDB credentials in `.env`.
3. Install dependencies:

```bash
npm install
```

4. Start:

```bash
npm run dev
```

5. Test:

```text
GET http://localhost:10000/api/health
```

## Render

Create a Render Web Service:

- Runtime: Node
- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/api/health`

Environment variables:

```text
NODE_ENV=production
KASA_DB_HOST=gateway01.ap-southeast-1.prod.aws.tidbcloud.com
KASA_DB_PORT=4000
KASA_DB_NAME=kasa_ilaya_resort
KASA_DB_USER=your_tidb_user
KASA_DB_PASS=your_tidb_password
FRONTEND_URL=https://your-vercel-domain.vercel.app
JWT_SECRET=generate-a-long-random-secret
JWT_EXPIRES_IN=7d
```

Do not commit `.env`.

## Initial endpoints

- `GET /`
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/packages`
- `GET /api/packages/:id`
- `GET /api/reviews`
- `GET /api/resortRules`
- `GET /api/schedules`
- `GET /api/paymentQrCodes`
- `GET /api/siteSettings`
- `GET /api/bookings`
- `GET /api/inquiries`
- `GET /api/foundItems`
- `GET /api/lostItemReports`

Authenticated write endpoints use:

```text
Authorization: Bearer <JWT>
```

## Important migration note

This is a clean Node.js replacement backend based on the current Kasa Ilaya TiDB schema. It is not guaranteed to be a drop-in replacement for every old PHP endpoint or frontend API path.

Before deleting the old PHP backend, compare the frontend's API calls with these routes and migrate any additional business logic from the PHP implementation.
