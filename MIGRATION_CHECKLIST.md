# Migration checklist

## 1. Keep the old PHP backend temporarily
Do not delete the current PHP backend until the frontend has been switched to the Node API and tested.

## 2. Install and test locally

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Open:

`http://localhost:10000/api/health`

## 3. Render

Use native Node runtime:

- Runtime: Node
- Build: `npm ci`
- Start: `npm start`
- Health check: `/api/health`

Do not use the old Dockerfile.

## 4. Vercel

Set:

`NEXT_PUBLIC_API_URL=https://YOUR-RENDER-SERVICE.onrender.com`

## 5. TiDB

Set the TiDB values in Render Environment Variables only.

Never commit the real password.

## 6. Before switching production traffic

Test:

- health check
- login
- registration
- package listing
- booking creation/update
- payment status
- reviews
- inquiries/messages
- lost/found items
- admin authorization
- CORS from the Vercel domain

The generic resource router is a migration foundation. Existing PHP-specific validation, email/SMS, OTP, payment verification, rebooking workflows, and other business rules should be ported before production use.
