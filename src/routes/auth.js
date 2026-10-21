const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const config = require('../config/env');
const { pool } = require('../config/database');
const {
  id,
  now,
  sha256,
  randomOtp,
  publicUser,
  findUserById,
  findUserByEmail
} = require('../utils');

const { auth, requireAuth } = require('../middleware/auth');
const { sendMail } = require('../services/mail');
const { isStrongPassword } = require('../services/passwordPolicy');

const router = express.Router();
const MAX_OTP_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_IP_WINDOW_MS = 60 * 60 * 1000;
const OTP_IP_MAX_PER_HOUR = 10;
const otpIpRequests = new Map();
const DEVICE_ID_COOKIE = 'kasa_device_id';
const PENDING_GOOGLE_SIGNUP_COOKIE = 'pending_google_signup';
const PENDING_GOOGLE_SIGNUP_CSRF_COOKIE = 'pending_google_signup_csrf';

function consumeOtpIpRequest(req, purpose) {
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100);
  const key = `${purpose}:${ip}`;
  const cutoff = Date.now() - OTP_IP_WINDOW_MS;
  const recent = (otpIpRequests.get(key) || []).filter((timestamp) => timestamp > cutoff);
  const tooSoon = recent.length > 0 && Date.now() - recent[recent.length - 1] < OTP_RESEND_COOLDOWN_MS;
  if (tooSoon || recent.length >= OTP_IP_MAX_PER_HOUR) {
    otpIpRequests.set(key, recent);
    return false;
  }

  recent.push(Date.now());
  otpIpRequests.set(key, recent);
  if (otpIpRequests.size > 10000) {
    for (const [oldKey, timestamps] of otpIpRequests) {
      if (!timestamps.length || timestamps[timestamps.length - 1] <= cutoff) otpIpRequests.delete(oldKey);
      if (otpIpRequests.size <= 8000) break;
    }
  }
  return true;
}

async function otpRecipientIsRateLimited(table, ownerColumn, ownerId) {
  // Table and column are selected only from fixed call sites below.
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS request_count,
            TIMESTAMPDIFF(SECOND, MAX(created_date), UTC_TIMESTAMP()) AS seconds_since_last
     FROM ${table}
     WHERE ${ownerColumn}=? AND created_date >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)`,
    [ownerId]
  );
  const count = Number(rows[0]?.request_count || 0);
  const elapsed = rows[0]?.seconds_since_last === null ? Infinity : Number(rows[0]?.seconds_since_last);
  return count >= 5 || (count > 0 && elapsed < OTP_RESEND_COOLDOWN_MS / 1000);
}

const getTrustedFrontendOrigin = (req) => {
  const configuredOrigins = String(config.frontendUrl || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const requestOrigin = String(req.get('origin') || '').replace(/\/$/, '');

  if (configuredOrigins.includes(requestOrigin)) return requestOrigin;
  if (config.nodeEnv !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)) {
    return requestOrigin;
  }
  return configuredOrigins[0] || '';
};

const redirectGoogleLogin = (req, res, result) => {
  const origin = getTrustedFrontendOrigin(req);
  if (!origin) {
    return res.status(500).json({ error: 'Google sign-in redirect is not configured.' });
  }

  const destination = new URL('/Login', origin);
  destination.searchParams.set('google_login', result);
  return res.redirect(303, destination.toString());
};

const pendingGoogleCookieOptions = () => ({
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
  path: '/api',
  maxAge: 10 * 60 * 1000
});
const escapeAuthHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const registrationOtp = () =>
  config.sampleRegistrationOtp || randomOtp();

/* =========================================================
   VALIDATION HELPERS
========================================================= */

const emailOk = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

const phoneOk = (phone) =>
  /^(09\d{9}|639\d{9})$/.test(
    String(phone || '').replace(/\D/g, '')
  );

const validDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const ageFromDateOnly = (value) => {
  const [year, month, day] = String(value).split('-').map(Number);
  const today = new Date();
  let age = today.getUTCFullYear() - year;
  const birthdayHasPassed = today.getUTCMonth() + 1 > month
    || (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day);
  if (!birthdayHasPassed) age -= 1;
  return age;
};

/* =========================================================
   AUTH TOKEN
========================================================= */

async function recordAccountActivity(userId, eventType, description) {
  await pool.query(
    `INSERT INTO account_activity (id,user_id,event_type,description,created_at)
     VALUES (?,?,?,?,?)`,
    [id('account-activity'), userId, eventType, description, now()]
  );
}

async function sendLoginNotification(user) {
  try {
    const [settings] = await pool.query('SELECT enable_login_notifications FROM site_settings LIMIT 1');
    if (settings[0]?.enable_login_notifications === 0 || settings[0]?.enable_login_notifications === false) return;
    const signedInAt = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short',
    }).format(new Date());
    const origin = String(config.frontendUrl || '').split(',')[0].trim().replace(/\/$/, '');
    const accountUrl = origin ? `${origin}/ProfileSettings` : '/ProfileSettings';
    const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    const result = await sendMail(
      user.email,
      'New sign-in to your Kasa Ilaya Resort account',
      `<p>Hello ${escapeHtml(user.full_name || 'there')},</p>
       <p>Your Kasa Ilaya Resort account was signed in successfully.</p>
       <p><strong>Time:</strong> ${escapeHtml(signedInAt)} (Philippine time)</p>
       <p>If this was you, no action is needed. If you don’t recognize this sign-in, please reset your password and contact the resort.</p>
       <p><a href="${escapeHtml(accountUrl)}" style="display:inline-block;background:#0d5558;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-weight:bold;">Review my account</a></p>`,
      'login_notification'
    );
    if (!result.sent) console.error('Login notification email was not delivered', { userId: user.id, error: result.error });
  } catch (error) {
    console.error('Login notification could not be sent', { userId: user.id, code: error.code });
  }
}

const sessionLocationFromProxy = (req) => {
  const readHeader = (...names) => names.map((name) => String(req?.get?.(name) || '').trim()).find(Boolean) || '';
  const city = readHeader('cf-ipcity', 'x-vercel-ip-city');
  const region = readHeader('cf-region', 'x-vercel-ip-country-region');
  const country = readHeader('cf-ipcountry', 'x-vercel-ip-country');
  return [city, region, country].filter(Boolean).join(', ').slice(0, 191) || null;
};

async function issue(res, user, req) {
  let deviceId = String(req?.cookies?.[DEVICE_ID_COOKIE] || '');
  if (!/^[a-f0-9]{64}$/i.test(deviceId)) {
    deviceId = crypto.randomBytes(32).toString('hex');
    res.cookie?.(DEVICE_ID_COOKIE, deviceId, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      path: '/api',
      maxAge: 365 * 86400000
    });
  }
  const deviceFingerprint = sha256(deviceId);
  const [knownDevices] = await pool.query(
    `SELECT id FROM auth_sessions
     WHERE user_id=? AND device_fingerprint=?
     LIMIT 1`,
    [user.id, deviceFingerprint]
  );
  const isUnfamiliarDevice = !knownDevices[0];
  const sessionId = crypto.randomUUID();
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const ipAddress = String(req?.ip || req?.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 45) || null;
  const location = sessionLocationFromProxy(req);
  await pool.query(
    `INSERT INTO auth_sessions (id,user_id,user_agent,ip_address,location,device_fingerprint,created_at,last_seen_at,expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [sessionId, user.id, String(req?.get('user-agent') || '').slice(0, 512) || null, ipAddress, location, deviceFingerprint, createdAt, createdAt, expiresAt]
  );
  await recordAccountActivity(user.id, 'sign_in', 'Signed in successfully.');
  const token = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      app_role: user.app_role,
      sid: sessionId
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn
    }
  );

  res.cookie?.('kasa_token', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    path: '/api',
    maxAge: 7 * 86400000
  });

  return { isUnfamiliarDevice };
}

/* =========================================================
   AGE
========================================================= */

function ageFromDate(value) {
  if (!value) return null;

  const d = new Date(`${value}T00:00:00`);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

  const today = new Date();

  let age =
    today.getFullYear() -
    d.getFullYear();

  const beforeBirthday =
    today.getMonth() < d.getMonth() ||
    (
      today.getMonth() === d.getMonth() &&
      today.getDate() < d.getDate()
    );

  if (beforeBirthday) {
    age -= 1;
  }

  return age;
}

/* =========================================================
   GOOGLE LOGIN
========================================================= */

async function verifyGoogleCredential(credential) {
  if (!config.googleClientId) {
    throw Object.assign(
      new Error('Google sign-in is not configured.'),
      { status: 503 }
    );
  }

  let response;
  try {
    response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        credential
      )}`,
      { signal: AbortSignal.timeout(10000) }
    );
  } catch {
    throw Object.assign(
      new Error('Google sign-in is temporarily unavailable.'),
      { status: 503 }
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error('Google credential is invalid or expired.'),
      { status: 401 }
    );
  }

  const payload = await response.json();

  if (payload.aud !== config.googleClientId) {
    throw Object.assign(
      new Error('Google token audience is invalid.'),
      { status: 401 }
    );
  }

  if (
    ![
      'accounts.google.com',
      'https://accounts.google.com'
    ].includes(payload.iss)
  ) {
    throw Object.assign(
      new Error('Google token issuer is invalid.'),
      { status: 401 }
    );
  }

  const expiresAt = Number(payload.exp);
  if (
    !String(payload.sub || '').trim() ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw Object.assign(
      new Error('Google credential is invalid or expired.'),
      { status: 401 }
    );
  }

  if (
    payload.email_verified !== 'true' &&
    payload.email_verified !== true
  ) {
    throw Object.assign(
      new Error('Google account email is not verified.'),
      { status: 401 }
    );
  }

  return payload;
}

/* =========================================================
   GET AUTH ACTIONS
========================================================= */

router.get('/', async (req, res, next) => {
  try {
    const action = req.query.action || 'me';

    /* ---------- CURRENT USER ---------- */

    if (action === 'me') {
      if (!req.user) {
        return res.status(401).json({
          error: 'Not authenticated.'
        });
      }

      return res.json(req.publicUser);
    }

    if (action === 'account-sessions') {
      if (!req.user || !req.authSessionId) return res.status(401).json({ error: 'Not authenticated.' });
      const [rows] = await pool.query(
        `SELECT id, user_agent, ip_address, location, created_at, last_seen_at, expires_at
         FROM auth_sessions
         WHERE user_id=? AND revoked_at IS NULL AND expires_at>NOW()
         ORDER BY last_seen_at DESC`,
        [req.user.id]
      );
      return res.json(rows.map((session) => ({ ...session, current: session.id === req.authSessionId })));
    }

    if (action === 'account-activity') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = 25;
      const [rows] = await pool.query(
        `SELECT event_type, description, created_at
         FROM account_activity WHERE user_id=?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [req.user.id, limit, (page - 1) * limit]
      );
      return res.json({ items: rows, page, has_more: rows.length === limit });
    }

    /* ---------- GOOGLE CONFIG ---------- */

    if (action === 'google-config') {
      return res.json({
        enabled: !!config.googleClientId,
        client_id: config.googleClientId || null
      });
    }

    if (action === 'google-signup-csrf') {
      const token = String(req.cookies?.[PENDING_GOOGLE_SIGNUP_CSRF_COOKIE] || '');
      if (!req.cookies?.[PENDING_GOOGLE_SIGNUP_COOKIE] || !token) {
        return res.status(401).json({ error: 'The pending Google signup expired. Please continue with Google again.' });
      }
      return res.json({ csrf_token: token });
    }

    /* ---------- FIREBASE CONFIG ---------- */

    if (action === 'firebase-config') {
      return res.json({
        enabled: false
      });
    }

    if (action === 'validate-reset-token') {
      const token = String(req.query.token || '');
      if (!token) {
        return res.status(422).json({ error: 'Reset authorization is required.' });
      }

      const [rows] = await pool.query(
        `SELECT u.email,t.purpose,r.requested_email
         FROM password_reset_tokens t
         INNER JOIN users u ON u.id=t.user_id
         LEFT JOIN account_recovery_requests r ON r.id=t.recovery_request_id
         WHERE t.token_hash=?
           AND (t.purpose='reset_authorization' OR (t.purpose='account_recovery' AND r.status='approved'))
           AND t.used_at IS NULL
           AND t.expires_at>NOW()
           AND u.disabled=0
           AND (t.purpose='account_recovery' OR NULLIF(TRIM(u.password_hash), '') IS NOT NULL)
         LIMIT 1`,
        [sha256(token)]
      );

      if (!rows[0]) {
        return res.status(404).json({ error: 'This reset authorization is invalid or expired.' });
      }

      return res.json({ valid: true, email: rows[0].requested_email || rows[0].email, recovery: rows[0].purpose === 'account_recovery' });
    }

    if (action === 'admin-account-recovery-list') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
      const actorRole = req.user.role || req.user.app_role;
      if (!['admin', 'super_admin'].includes(actorRole)) {
        return res.status(403).json({ error: 'Only resort administrators can access account recovery requests.' });
      }
      const adminScope = actorRole === 'super_admin' ? '' : " AND u.role='guest'";
      const [rows] = await pool.query(
        `SELECT r.id,r.old_email,r.requested_email,r.full_name,r.phone,r.booking_reference,r.reason,r.created_date,
                u.email AS account_email,u.full_name AS account_full_name,u.phone AS account_phone
         FROM account_recovery_requests r
         LEFT JOIN users u ON u.id=r.user_id
         WHERE r.status='pending'${adminScope}
         ORDER BY r.created_date ASC LIMIT 100`
      );
      return res.json(rows);
    }

    return res.status(405).json({
      error: 'Unsupported auth action.'
    });

  } catch (error) {
    next(error);
  }
});

/* =========================================================
   POST AUTH ACTIONS
========================================================= */

router.post('/', async (req, res, next) => {
  try {
    const p = req.body || {};
    const isGoogleRedirectPayload = Boolean(p.credential && p.g_csrf_token);
    const action = req.query.action || (isGoogleRedirectPayload ? 'google-login' : '');

    if (action === 'request-account-recovery') {
      const oldEmail = String(p.old_email || '').trim().toLowerCase();
      const requestedEmail = String(p.requested_email || '').trim().toLowerCase();
      const fullName = String(p.full_name || '').trim().slice(0, 191);
      const phone = String(p.phone || '').trim().slice(0, 32);
      const bookingReference = String(p.booking_reference || '').trim().slice(0, 64);
      const reason = String(p.reason || '').trim().slice(0, 1000);
      if (oldEmail.length > 191 || requestedEmail.length > 191
        || !emailOk(oldEmail) || !emailOk(requestedEmail) || oldEmail === requestedEmail
        || !fullName || !phone || !phoneOk(phone)) {
        return res.status(422).json({ error: 'Enter the old and new email addresses, your full name, and a valid phone number. The new email must be different.' });
      }

      const genericResponse = {
        success: true,
        message: 'If an eligible account was found, the recovery request has been sent for admin review. Contact the resort through its official channels if you need help.',
      };
      if (!consumeOtpIpRequest(req, 'account-recovery')) return res.json(genericResponse);

      const connection = await pool.getConnection();
      let createdRequest = null;
      try {
        await connection.beginTransaction();
        const [users] = await connection.query(
          'SELECT id,email,disabled FROM users WHERE LOWER(email)=LOWER(?) LIMIT 1 FOR UPDATE',
          [oldEmail]
        );
        const user = users[0];
        if (user && !user.disabled) {
          const [emailOwners] = await connection.query(
            'SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id<>? LIMIT 1',
            [requestedEmail, user.id]
          );
          const [recentRequests] = await connection.query(
            `SELECT COUNT(*) AS request_count FROM account_recovery_requests
             WHERE user_id=? AND created_date>=DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)`,
            [user.id]
          );
          const [pendingRequests] = await connection.query(
            "SELECT id FROM account_recovery_requests WHERE user_id=? AND status='pending' LIMIT 1",
            [user.id]
          );
          if (!emailOwners.length && Number(recentRequests[0]?.request_count || 0) < 3 && !pendingRequests.length) {
            const createdAt = now();
            createdRequest = id('recovery');
            await connection.query(
              `INSERT INTO account_recovery_requests
               (id,user_id,old_email,requested_email,full_name,phone,booking_reference,reason,status,created_date,updated_date)
               VALUES (?,?,?,?,?,?,?,?, 'pending',?,?)`,
              [createdRequest, user.id, oldEmail, requestedEmail, fullName, phone, bookingReference || null, reason || null, createdAt, createdAt]
            );
          }
        }
        await connection.commit();
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally {
        connection.release();
      }
      if (createdRequest) {
        void (async () => {
          const [admins] = await pool.query(
            "SELECT email FROM users WHERE disabled=0 AND role='super_admin' AND email IS NOT NULL"
          );
          const recipients = [...new Set([config.mail.admin, ...admins.map((admin) => admin.email)]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean))];
          await Promise.all(recipients.map((recipient) => sendMail(
            recipient,
            'Account recovery request needs review | Kasa Ilaya Resort',
            `<p>A user submitted an account recovery request that needs manual identity verification.</p>
             <p><strong>Account email:</strong> ${escapeAuthHtml(oldEmail)}<br>
             <strong>Requested email:</strong> ${escapeAuthHtml(requestedEmail)}<br>
             <strong>Name submitted:</strong> ${escapeAuthHtml(fullName)}<br>
             <strong>Phone submitted:</strong> ${escapeAuthHtml(phone)}<br>
             <strong>Booking reference:</strong> ${escapeAuthHtml(bookingReference || 'Not provided')}</p>
             <p>Review the request in User Permissions. Contact the user using the phone number already on the account before approving.</p>`,
            'account_recovery_admin'
          )));
        })().catch((error) => console.error('Account recovery admin notification failed', { code: error.code, requestId: createdRequest }));
      }
      return res.json(genericResponse);
    }

    if (action === 'admin-review-account-recovery') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
      const actorRole = req.user.role || req.user.app_role;
      if (!['admin', 'super_admin'].includes(actorRole)) {
        return res.status(403).json({ error: 'Only resort administrators can review account recovery requests.' });
      }
      const requestId = String(p.request_id || '').trim();
      const decision = String(p.decision || '').trim().toLowerCase();
      const reviewNote = String(p.review_note || '').trim().slice(0, 1000);
      if (!requestId || !['approve', 'decline'].includes(decision)) {
        return res.status(422).json({ error: 'Choose a valid account recovery request and decision.' });
      }
      if (decision === 'approve' && p.identity_verified !== true) {
        return res.status(422).json({ error: 'Confirm that the person was verified using contact information already on file before approving recovery.' });
      }
      if (decision === 'decline' && reviewNote.length < 5) {
        return res.status(422).json({ error: 'Add a brief reason before declining this recovery request.' });
      }
      const recoveryOrigin = getTrustedFrontendOrigin(req);
      if (decision === 'approve' && !recoveryOrigin) {
        return res.status(503).json({ error: 'The recovery link cannot be created because the frontend URL is not configured.' });
      }

      const connection = await pool.getConnection();
      let recoveryEmail = '';
      let recoveryFullName = '';
      let recoveryToken = '';
      try {
        await connection.beginTransaction();
        const [requests] = await connection.query(
          `SELECT r.*,u.email AS account_email,u.disabled,u.role AS account_role
           FROM account_recovery_requests r
           LEFT JOIN users u ON u.id=r.user_id
           WHERE r.id=? FOR UPDATE`,
          [requestId]
        );
        const recovery = requests[0];
        if (!recovery || recovery.status !== 'pending') {
          await connection.rollback();
          return res.status(404).json({ error: 'That account recovery request is no longer pending.' });
        }
        if (!recovery.account_email || recovery.disabled) {
          await connection.rollback();
          return res.status(409).json({ error: 'The account is no longer eligible for recovery.' });
        }
        if (actorRole === 'admin' && recovery.account_role !== 'guest') {
          await connection.rollback();
          return res.status(403).json({ error: 'Only a super admin can review recovery requests for administrator accounts.' });
        }
        if (String(req.user.id) === String(recovery.user_id)) {
          await connection.rollback();
          return res.status(403).json({ error: 'You cannot review your own account recovery request.' });
        }

        if (decision === 'decline') {
          const reviewedAt = now();
          await connection.query(
            `UPDATE account_recovery_requests SET status='declined',reviewed_by=?,reviewed_at=?,review_note=?,updated_date=? WHERE id=? AND status='pending'`,
            [req.user.id, reviewedAt, reviewNote, reviewedAt, requestId]
          );
          await connection.query(
            `INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [id('activitylog'), reviewedAt, reviewedAt, req.user.email || null, req.user.full_name || req.user.name || 'Super admin', 'super_admin', 'Declined account recovery request', 'User', recovery.user_id, `Declined recovery request ${requestId}. ${reviewNote}`]
          );
          await connection.commit();
          recoveryEmail = recovery.requested_email;
          recoveryFullName = recovery.full_name;
        } else {
          const [emailOwners] = await connection.query(
            'SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id<>? LIMIT 1 FOR UPDATE',
            [recovery.requested_email, recovery.user_id]
          );
          if (emailOwners.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'The requested email is already connected to another account. Ask the user to submit a different email.' });
          }

          recoveryToken = crypto.randomBytes(32).toString('hex');
          const tokenHash = sha256(recoveryToken);
          const reviewedAt = now();
          await connection.query(
            `UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL`,
            [reviewedAt, recovery.user_id]
          );
          await connection.query(
            `INSERT INTO password_reset_tokens (id,user_id,token_hash,purpose,attempts,recovery_request_id,created_date,expires_at)
             VALUES (?,?,?,'account_recovery',0,?,?,?)`,
            [id('resettoken'), recovery.user_id, tokenHash, requestId, reviewedAt, new Date(Date.now() + 900000).toISOString().slice(0, 19).replace('T', ' ')]
          );
          await connection.query(
            `UPDATE account_recovery_requests SET status='approved',reviewed_by=?,reviewed_at=?,review_note=?,updated_date=? WHERE id=? AND status='pending'`,
            [req.user.id, reviewedAt, reviewNote || null, reviewedAt, requestId]
          );
          await connection.query(
            `INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [id('activitylog'), reviewedAt, reviewedAt, req.user.email || null, req.user.full_name || req.user.name || 'Super admin', 'super_admin', 'Approved account recovery request', 'User', recovery.user_id, `Approved recovery request ${requestId}; a one-time link was issued to ${recovery.requested_email}.`]
          );
          await connection.commit();
          recoveryEmail = recovery.requested_email;
          recoveryFullName = recovery.full_name;
        }
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally {
        connection.release();
      }

      if (decision === 'decline') {
        const recoveryUrl = recoveryOrigin ? new URL('/AccountRecoveryHelp', recoveryOrigin).toString() : '';
        const recoveryLink = recoveryUrl
          ? `<p>If you have additional details, you can submit a new request <a href="${escapeAuthHtml(recoveryUrl)}">here</a>.</p>`
          : '';
        const mail = await sendMail(
          recoveryEmail,
          'Update on your Kasa Ilaya Resort account recovery request',
          `<p>Hello ${escapeAuthHtml(recoveryFullName || 'there')},</p>
           <p>Your account recovery request was reviewed and declined by a resort super admin.</p>
           <p><strong>Reason from the admin:</strong></p>
           <blockquote style="margin:12px 0;padding:12px 16px;border-left:4px solid #0d5558;background:#f4f6f5">${escapeAuthHtml(reviewNote)}</blockquote>
           ${recoveryLink}
           <p>If you need clarification, contact us at <a href="mailto:info@kasailaya.com">info@kasailaya.com</a> or call <a href="tel:+639053869255">09053869255</a>. Do not send your password by email.</p>`,
          'account_recovery_declined'
        );
        if (!mail.sent) console.error('Account recovery decline email was not delivered', { requestId, error: mail.error });
        return res.json({ success: true, decision: 'declined', email_sent: mail.sent });
      }

      const resetUrl = new URL('/ResetPassword', recoveryOrigin);
      resetUrl.searchParams.set('token', recoveryToken);
      const mail = await sendMail(
        recoveryEmail,
        'Your account recovery request was approved | Kasa Ilaya Resort',
        `<p>Hello ${escapeAuthHtml(recoveryFullName || 'there')},</p>
         <p>Your account recovery request has been <strong>approved</strong> by a resort super admin. Use this one-time link to verify your new email address and set a new password.</p>
         ${reviewNote ? `<p><strong>Admin comment:</strong> ${escapeAuthHtml(reviewNote)}</p>` : ''}
         <p><a href="${escapeAuthHtml(resetUrl.toString())}" style="display:inline-block;background:#0d5558;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-weight:bold;">Verify email and reset password</a></p>
         <p>This link expires in 15 minutes and works once. If you did not request this, contact Kasa Ilaya Resort using its official contact details.</p>`,
        'account_recovery'
      );
      if (!mail.sent) {
        await pool.query('UPDATE password_reset_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL', [now(), sha256(recoveryToken)]);
        await pool.query("UPDATE account_recovery_requests SET status='pending',reviewed_by=NULL,reviewed_at=NULL,review_note=NULL,updated_date=? WHERE id=? AND status='approved'", [now(), requestId]);
        return res.status(502).json({ error: mail.error || 'Unable to send the recovery link. The request remains pending.' });
      }
      return res.json({ success: true, decision: 'approved', email_sent: true });
    }

    if (action === 'admin-create-account') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
      const actorRole = req.user.role || req.user.app_role;
      if (actorRole !== 'super_admin') {
        return res.status(403).json({ error: 'Only a super admin can create administrator accounts.' });
      }

      const role = String(p.role || '').trim();
      if (!['admin', 'super_admin'].includes(role)) {
        return res.status(422).json({ error: 'Choose Admin or Super Admin for this account.' });
      }
      if (role === 'super_admin' && actorRole !== 'super_admin') {
        return res.status(403).json({ error: 'Only a super admin can create another super admin account.' });
      }

      const fullName = String(p.full_name || '').trim().slice(0, 191);
      const email = String(p.email || '').trim().toLowerCase();
      const phone = String(p.phone || '').trim();
      const password = String(p.password || '');
      if (!fullName || !email || !phone || !password) {
        return res.status(422).json({ error: 'Name, email, phone number, and a password are required.' });
      }
      if (email.length > 191) return res.status(422).json({ error: 'Email address must be 191 characters or fewer.' });
      if (!emailOk(email)) return res.status(422).json({ error: 'Please enter a valid email address.' });
      if (!phoneOk(phone)) return res.status(422).json({ error: 'Please enter a valid Philippine mobile number.' });
      if (!isStrongPassword(password)) {
        return res.status(422).json({ error: 'Password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and special character.' });
      }
      if (await findUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });

      const userId = id('user');
      const createdAt = now();
      const passwordHash = await bcrypt.hash(password, 12);
      try {
        await pool.query(
          `INSERT INTO users
           (id,created_date,updated_date,email,full_name,birth_date,phone,role,password_hash,disabled,is_verified,app_id,is_service,app_role)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [userId, createdAt, createdAt, email, fullName, null, phone.replace(/\D/g, ''), role, passwordHash, 0, 1, 'local-kasa-ilaya', 0, role]
        );
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account with that email already exists.' });
        throw error;
      }

      try {
        await pool.query(
          `INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [id('activitylog'), createdAt, createdAt, req.user.email || null, req.user.full_name || 'Administrator', role === 'super_admin' ? 'Created Super Admin Account' : 'Created Admin Account', 'User', userId, `Created ${role === 'super_admin' ? 'super admin' : 'admin'} account for ${email}.`]
        );
      } catch (error) {
        console.error('Administrator account creation audit log failed', { userId, code: error.code });
      }

      return res.status(201).json({ success: true, id: userId, email, full_name: fullName, role, app_role: role });
    }

    if (action === 'revoke-session') {
      if (!req.user || !req.authSessionId) return res.status(401).json({ error: 'Not authenticated.' });
      const sessionId = String(p.session_id || '').trim();
      if (!sessionId || sessionId === req.authSessionId) {
        return res.status(422).json({ error: 'Choose another active device to sign out.' });
      }
      const [result] = await pool.query(
        `UPDATE auth_sessions SET revoked_at=NOW()
         WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>NOW()`,
        [sessionId, req.user.id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'That session is no longer active.' });
      await recordAccountActivity(req.user.id, 'session_revoked', 'Signed out another device.');
      return res.json({ success: true });
    }

    if (action === 'revoke-other-sessions') {
      if (!req.user || !req.authSessionId) return res.status(401).json({ error: 'Not authenticated.' });
      const [result] = await pool.query(
        `UPDATE auth_sessions SET revoked_at=NOW()
         WHERE user_id=? AND id<>? AND revoked_at IS NULL AND expires_at>NOW()`,
        [req.user.id, req.authSessionId]
      );
      await recordAccountActivity(req.user.id, 'sessions_revoked', 'Signed out all other devices.');
      return res.json({ success: true, revoked_count: result.affectedRows || 0 });
    }

    if (action === 'admin-send-password-reset-link') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
      if ((req.user.role || req.user.app_role) !== 'super_admin') {
        return res.status(403).json({ error: 'Only a super admin can send password reset links.' });
      }

      const userId = String(p.user_id || '').trim();
      if (!userId) return res.status(422).json({ error: 'Choose a user account first.' });

      const [users] = await pool.query(
        'SELECT id,email,full_name,password_hash,disabled FROM users WHERE id=? LIMIT 1',
        [userId]
      );
      const target = users[0];
      if (!target || target.disabled) return res.status(404).json({ error: 'The active user account was not found.' });
      if (!target.password_hash) {
        return res.status(422).json({ error: 'This account uses Google sign-in. Its password must be managed through Google.' });
      }

      const origin = getTrustedFrontendOrigin(req);
      if (!origin) return res.status(503).json({ error: 'The password reset link cannot be created because the frontend URL is not configured.' });
      if (await otpRecipientIsRateLimited('password_reset_tokens', 'user_id', target.id)) {
        return res.status(429).json({ error: 'A password reset link was sent recently. Please wait before sending another.' });
      }

      const token = crypto.randomBytes(32).toString('hex');
      const createdAt = now();
      const expiresAt = new Date(Date.now() + 900000).toISOString().slice(0, 19).replace('T', ' ');
      await pool.query(
        `INSERT INTO password_reset_tokens
         (id,user_id,token_hash,purpose,attempts,created_date,expires_at)
         VALUES (?,?,?,?,?,?,?)`,
        [id('resettoken'), target.id, sha256(token), 'reset_authorization', 0, createdAt, expiresAt]
      );

      const resetUrl = new URL('/ResetPassword', origin);
      resetUrl.searchParams.set('token', token);
      const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      })[character]);
      const mail = await sendMail(
        target.email,
        'Reset your Kasa Ilaya Resort password',
        `<p>Hello ${escapeHtml(target.full_name || 'there')},</p>
         <p>A super admin requested a password reset link for your Kasa Ilaya Resort account.</p>
         <p><a href="${escapeHtml(resetUrl.toString())}" style="display:inline-block;background:#0d5558;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:7px;font-weight:bold;">Reset password</a></p>
         <p>This link expires in 15 minutes and can be used once. If you did not expect this email, you can ignore it.</p>`,
        'admin_password_reset'
      );

      if (!mail.sent) {
        await pool.query(
          'UPDATE password_reset_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL',
          [now(), sha256(token)]
        );
        return res.status(502).json({ error: mail.error || 'Unable to send the password reset email.' });
      }

      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at=?
         WHERE user_id=? AND purpose='reset_authorization' AND used_at IS NULL AND token_hash<>?`,
        [now(), target.id, sha256(token)]
      );

      try {
        await pool.query(
          `INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,action,entity_type,entity_id,details)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [id('activitylog'), now(), now(), req.user.email || null, req.user.full_name || req.user.name || 'Super admin', 'Sent password reset link', 'User', target.id, `Sent a password reset link to ${target.email}.`]
        );
      } catch (error) {
        console.error('Password reset link audit log failed', { userId: target.id, code: error.code });
      }

      return res.json({ success: true, email_sent: true });
    }

    /* =====================================================
       LOGIN
    ===================================================== */

    if (action === 'login') {
      const email = String(p.email || '')
        .trim()
        .toLowerCase();

      const password = String(p.password || '');

      if (!email || !password) {
        return res.status(422).json({
          error: 'Email and password are required.'
        });
      }

      if (!emailOk(email)) {
        return res.status(422).json({
          error: 'Please enter a valid email address.'
        });
      }

      const user = await findUserByEmail(email);

      if (
        !user ||
        !user.password_hash ||
        !(await bcrypt.compare(
          password,
          user.password_hash
        ))
      ) {
        return res.status(401).json({
          error: 'Invalid email or password.'
        });
      }

      if (!user.is_verified) {
        return res.status(403).json({
          error:
            'Please verify your email address before signing in.',
          code: 'email_not_verified'
        });
      }

      if (user.disabled) {
        return res.status(403).json({
          error: 'This account is disabled.'
        });
      }

      const { isUnfamiliarDevice } = await issue(res, user, req);
      if (isUnfamiliarDevice) void sendLoginNotification(user);

      return res.json({
        success: true,
        next_url: p.next_url || '/',
        user: publicUser(user)
      });
    }

    /* =====================================================
       GOOGLE LOGIN
    ===================================================== */

    if (action === 'google-login' || action === 'google-signup-complete') {
      const isRedirectFlow = req.query.gis_redirect === '1'
        || (!req.query.action && Boolean(p.g_csrf_token));
      const isSignupCompletion = action === 'google-signup-complete';
      const credential = String(
        isSignupCompletion ? req.cookies?.[PENDING_GOOGLE_SIGNUP_COOKIE] : p.credential || ''
      ).trim();

      if (isSignupCompletion) {
        const submittedToken = Buffer.from(String(p.csrf_token || ''));
        const cookieToken = Buffer.from(String(req.cookies?.[PENDING_GOOGLE_SIGNUP_CSRF_COOKIE] || ''));
        if (!submittedToken.length || submittedToken.length !== cookieToken.length
          || !crypto.timingSafeEqual(submittedToken, cookieToken)) {
          return res.status(403).json({ error: 'Google signup expired or could not be verified. Please continue with Google again.' });
        }
      }

      if (isRedirectFlow) {
        const bodyCsrfToken = String(p.g_csrf_token || '');
        const cookieCsrfToken = String(req.cookies?.g_csrf_token || '');
        if (!bodyCsrfToken || !cookieCsrfToken || bodyCsrfToken !== cookieCsrfToken) {
          return redirectGoogleLogin(req, res, 'csrf_error');
        }
      }

      if (!credential) {
        return res.status(422).json({
          error: 'Google credential is required.'
        });
      }

      let googleUser;

      try {
        googleUser =
          await verifyGoogleCredential(credential);
      } catch (error) {
        if (isRedirectFlow) return redirectGoogleLogin(req, res, 'verification_error');
        return res.status(error.status || 401).json({
          error:
            error.message ||
            'Unable to verify Google sign-in.'
        });
      }

      const email = String(
        googleUser.email || ''
      )
        .trim()
        .toLowerCase();

      if (!email || !emailOk(email)) {
        if (isRedirectFlow) return redirectGoogleLogin(req, res, 'verification_error');
        return res.status(401).json({
          error: 'Google account email is invalid.'
        });
      }

      let user = await findUserByEmail(email);

      if (user?.disabled) {
        if (isRedirectFlow) return redirectGoogleLogin(req, res, 'account_disabled');
        return res.status(403).json({
          error: 'This account is disabled.'
        });
      }

      if (!user) {
        const birthDate = String(
          p.birth_date || ''
        ).trim();

        if (!birthDate) {
          if (isRedirectFlow) {
            res.cookie(PENDING_GOOGLE_SIGNUP_COOKIE, credential, pendingGoogleCookieOptions());
            res.cookie(
              PENDING_GOOGLE_SIGNUP_CSRF_COOKIE,
              crypto.randomBytes(32).toString('hex'),
              { ...pendingGoogleCookieOptions(), httpOnly: false }
            );
            return redirectGoogleLogin(req, res, 'signup_required');
          }
          return res.status(403).json({
            error: 'Birthday and phone number are required to finish setting up your Google account.',
            code: 'google_signup_details_required'
          });
        }

        if (!validDateOnly(birthDate)) {
          return res.status(422).json({
            error: 'Please enter a valid birthday.'
          });
        }

        const age = ageFromDate(birthDate);

        if (age === null) {
          return res.status(403).json({
            error: 'Birthday and phone number are required to finish setting up your Google account.',
            code: 'google_signup_details_required'
          });
        }

        if (age < 0) {
          return res.status(422).json({
            error: 'Birthday cannot be in the future.'
          });
        }

        if (age < 18) {
          return res.status(422).json({
            error:
              'Guests must be at least 18 years old to create an account.'
          });
        }

        const phone = String(p.phone || '').trim();
        if (!phone) {
          return res.status(403).json({
            error: 'Birthday and phone number are required to finish setting up your Google account.',
            code: 'google_signup_details_required'
          });
        }
        if (!phoneOk(phone)) {
          return res.status(422).json({
            error: 'Enter a valid Philippine mobile number using 09XXXXXXXXX or 639XXXXXXXXX.'
          });
        }

        const fullName =
          String(
            googleUser.name ||
              [
                googleUser.given_name,
                googleUser.family_name
              ]
                .filter(Boolean)
                .join(' ') ||
              email.split('@')[0]
          ).trim();

        let profileImageUrl = String(p.profile_image_url || '').trim() || null;
        if (profileImageUrl && (
          profileImageUrl.length > 2048 ||
          !/^(?:https?:\/\/|\/)/i.test(profileImageUrl)
        )) {
          return res.status(422).json({ error: 'The profile image path is invalid.' });
        }
        if (!profileImageUrl) {
          try {
            const picture = new URL(String(googleUser.picture || ''));
            if (
              picture.protocol === 'https:' &&
              picture.hostname.endsWith('.googleusercontent.com')
            ) {
              profileImageUrl = picture.toString();
            }
          } catch {}
        }

        const n = now();

        try {
          await pool.query(
            `INSERT INTO users
            (
              id,
              created_date,
              updated_date,
              email,
              full_name,
              birth_date,
              phone,
              profile_image_url,
              role,
              password_hash,
              disabled,
              is_verified,
              app_id,
              is_service,
              app_role
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id('user'),
              n,
              n,
              email,
              fullName,
              birthDate,
              phone.replace(/\D/g, ''),
              profileImageUrl,
              'guest',
              null,
              0,
              1,
              'local-kasa-ilaya',
              0,
              'guest'
            ]
          );
        } catch (error) {
          if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
            user = await findUserByEmail(email);
          } else {
            console.error('Google account persistence failed', {
              code: error.code,
              errno: error.errno
            });
            if (isRedirectFlow) return redirectGoogleLogin(req, res, 'signup_error');
            return res.status(503).json({
              error: 'Unable to save your Google account right now. Please try again.'
            });
          }
        }

        user = user || await findUserByEmail(email);
        if (!user) {
          console.error('Google account insert completed without a readable user record.');
          if (isRedirectFlow) return redirectGoogleLogin(req, res, 'signup_error');
          return res.status(503).json({
            error: 'Unable to finish Google sign-in right now. Please try again.'
          });
        }

      } else if (!user.is_verified) {

        await pool.query(
          `UPDATE users
           SET is_verified=1,
               updated_date=?
           WHERE id=?`,
          [
            now(),
            user.id
          ]
        );

        user = await findUserByEmail(email);
      }

      const { isUnfamiliarDevice } = await issue(res, user, req);
      if (isUnfamiliarDevice && !isSignupCompletion) void sendLoginNotification(user);

      if (isSignupCompletion) {
        res.clearCookie(PENDING_GOOGLE_SIGNUP_COOKIE, pendingGoogleCookieOptions());
        res.clearCookie(PENDING_GOOGLE_SIGNUP_CSRF_COOKIE, {
          ...pendingGoogleCookieOptions(),
          httpOnly: false
        });
      }

      if (isRedirectFlow) {
        return redirectGoogleLogin(req, res, 'success');
      }

      return res.json({
        success: true,
        next_url: p.next_url || '/',
        user: publicUser(user)
      });
    }

    /* =====================================================
       LOGOUT
    ===================================================== */

    if (action === 'logout') {
      if (req.user && req.authSessionId) {
        await pool.query(
          `UPDATE auth_sessions SET revoked_at=NOW()
           WHERE id=? AND user_id=? AND revoked_at IS NULL`,
          [req.authSessionId, req.user.id]
        );
        await recordAccountActivity(req.user.id, 'sign_out', 'Signed out this device.');
      }
      res.clearCookie('kasa_token', { path: '/api' });

      return res.json({
        success: true,
        redirect_url: p.redirect_url || '/'
      });
    }

    /* =====================================================
       REGISTER
    ===================================================== */

    if (action === 'register') {

      let fullName =
        String(p.full_name || '').trim() ||
        [
          p.first_name,
          p.middle_name,
          p.last_name
        ]
          .filter(Boolean)
          .join(' ')
          .trim();

      const email = String(p.email || '')
        .trim()
        .toLowerCase();

      const phone = String(p.phone || '').trim();

      const password = String(
        p.password || ''
      );

      const birthDate = String(
        p.birth_date || ''
      ).trim();

      if (
        !fullName ||
        !email ||
        !phone ||
        !password
      ) {
        return res.status(422).json({
          error:
            'Full name, email, phone number, and password are required.'
        });
      }

      if (!emailOk(email)) {
        return res.status(422).json({
          error: 'Please enter a valid email address.'
        });
      }

      const age = ageFromDate(birthDate);

      if (age === null) {
        return res.status(422).json({
          error: 'Please enter a valid birthday.'
        });
      }

      if (age < 0) {
        return res.status(422).json({
          error: 'Birthday cannot be in the future.'
        });
      }

      if (age < 18) {
        return res.status(422).json({
          error:
            'Guests must be at least 18 years old to create an account.'
        });
      }

      if (!isStrongPassword(password)) {
        return res.status(422).json({
          error: 'Password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and special character.'
        });
      }

      if (!phoneOk(phone)) {
        return res.status(422).json({
          error:
            'Please enter a valid Philippine mobile number using 09XXXXXXXXX or 639XXXXXXXXX.'
        });
      }

      if (await findUserByEmail(email)) {
        return res.status(409).json({
          error:
            'An account with that email already exists.'
        });
      }

      const n = now();

      const hash =
        await bcrypt.hash(password, 12);

      const [existingPendingRows] =
        await pool.query(
          `SELECT id
           FROM pending_registrations
           WHERE email=?
           LIMIT 1`,
          [email]
        );

      const pendingId =
        existingPendingRows[0]?.id ||
        id('pending');

      if (!consumeOtpIpRequest(req, 'registration')) {
        return res.status(429).json({ error: 'Please wait before requesting another verification code.' });
      }
      if (existingPendingRows[0] && await otpRecipientIsRateLimited('registration_otps', 'pending_registration_id', pendingId)) {
        return res.status(429).json({ error: 'Please wait before requesting another verification code.' });
      }

      if (existingPendingRows[0]) {

        await pool.query(
          `UPDATE pending_registrations
           SET updated_date=?,
               full_name=?,
               birth_date=?,
               phone=?,
               password_hash=?,
               role=?,
               app_id=?,
               app_role=?
           WHERE id=?`,
          [
            n,
            fullName,
            birthDate,
            phone,
            hash,
            'guest',
            'local-kasa-ilaya',
            'guest',
            pendingId
          ]
        );

      } else {

        await pool.query(
          `INSERT INTO pending_registrations
          (
            id,
            created_date,
            updated_date,
            email,
            full_name,
            birth_date,
            phone,
            password_hash,
            role,
            app_id,
            app_role
          )
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            pendingId,
            n,
            n,
            email,
            fullName,
            birthDate,
            phone,
            hash,
            'guest',
            'local-kasa-ilaya',
            'guest'
          ]
        );
      }

      /* Create OTP */

      const otp = registrationOtp();

      await pool.query(
        `UPDATE registration_otps
         SET used_at=?
         WHERE pending_registration_id=?
         AND used_at IS NULL`,
        [
          n,
          pendingId
        ]
      );

      await pool.query(
        `INSERT INTO registration_otps
        (
          id,
          pending_registration_id,
          otp_hash,
          purpose,
          attempts,
          created_date,
          expires_at
        )
        VALUES (?,?,?,?,?,?,?)`,
        [
          id('otp'),
          pendingId,
          sha256(otp),
          'registration',
          0,
          n,
          new Date(
            Date.now() + 300000
          )
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
        ]
      );

      /* Send email */

      const mail = config.sampleRegistrationOtp
        ? { sent: true }
        : await sendMail(
        email,
        'Kasa Ilaya Resort verification code',
        `
          <p>Hello ${fullName.replace(
            /</g,
            '&lt;'
          )}</p>

          <p>
            Your verification code is
            <strong>${otp}</strong>.
          </p>

          <p>
            This code expires in 5 minutes.
          </p>
        `,
        'registration'
      );

      return res.status(
        existingPendingRows[0]
          ? 200
          : 201
      ).json({
        success: true,
        next_url: p.next_url || '/',
        pending: true,
        email,
        phone: phone.replace(/\D/g, ''),
        mail_sent: mail.sent === true,
        mail_error: mail.sent === false
          ? (mail.error || 'Please check SMTP settings.')
          : null,
        delivery_method: config.sampleRegistrationOtp
          ? 'development'
          : 'email',
        verification_provider: 'server',
        sample_registration_otp: config.sampleRegistrationOtp || undefined
      });
    }

    /* =====================================================
       SEND / RESEND REGISTRATION OTP
       THIS WAS MISSING IN YOUR ORIGINAL BACKEND
    ===================================================== */

    if (action === 'send-registration-otp') {

      const email = String(
        p.email || ''
      )
        .trim()
        .toLowerCase();

      if (!email) {
        return res.status(422).json({
          error: 'Email address is required.'
        });
      }

      if (!emailOk(email)) {
        return res.status(422).json({
          error:
            'Please enter a valid email address.'
        });
      }

      if (!consumeOtpIpRequest(req, 'registration')) {
        return res.status(429).json({ error: 'Please wait before requesting another verification code.' });
      }

      const [pendingRows] =
        await pool.query(
          `SELECT *
           FROM pending_registrations
           WHERE email=?
           LIMIT 1`,
          [email]
        );

      const pending = pendingRows[0];

      if (!pending) {
        return res.status(404).json({
          error:
            'No pending registration was found for this email address.'
        });
      }

      if (await otpRecipientIsRateLimited('registration_otps', 'pending_registration_id', pending.id)) {
        return res.status(429).json({ error: 'Please wait before requesting another verification code.' });
      }

      const n = now();

      /* Invalidate previous OTPs */

      await pool.query(
        `UPDATE registration_otps
         SET used_at=?
         WHERE pending_registration_id=?
         AND used_at IS NULL`,
        [
          n,
          pending.id
        ]
      );

      /* Generate new OTP */

      const otp = registrationOtp();

      await pool.query(
        `INSERT INTO registration_otps
        (
          id,
          pending_registration_id,
          otp_hash,
          purpose,
          attempts,
          created_date,
          expires_at
        )
        VALUES (?,?,?,?,?,?,?)`,
        [
          id('otp'),
          pending.id,
          sha256(otp),
          'registration',
          0,
          n,
          new Date(
            Date.now() + 300000
          )
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
        ]
      );

      /* Send OTP */

      const mail = config.sampleRegistrationOtp
        ? { sent: true }
        : await sendMail(
        email,
        'Kasa Ilaya Resort verification code',
        `
          <p>
            Hello ${String(
              pending.full_name || ''
            ).replace(/</g, '&lt;')}
          </p>

          <p>
            Your new verification code is
            <strong>${otp}</strong>.
          </p>

          <p>
            This code expires in 5 minutes.
          </p>
        `,
        'registration'
      );

      return res.json({
        success: true,
        email,
        mail_sent: mail.sent !== false,
        mail_error: mail.sent === false
          ? (mail.error || 'Please check SMTP settings.')
          : null,
        delivery_method: config.sampleRegistrationOtp
          ? 'development'
          : 'email',
        verification_provider: 'server',
        sample_registration_otp: config.sampleRegistrationOtp || undefined
      });
    }

    /* =====================================================
       VERIFY REGISTRATION OTP
    ===================================================== */

    if (action === 'verify-registration-otp') {

      if (p.terms_accepted !== true || p.privacy_acknowledged !== true) {
        return res.status(422).json({
          error: 'Accept the Terms & Conditions and acknowledge the Privacy Notice before finishing account creation.'
        });
      }

      const email = String(
        p.email || ''
      )
        .trim()
        .toLowerCase();

      const otp = String(
        p.otp || ''
      ).replace(/\D/g, '');

      if (!email || !emailOk(email)) {
        return res.status(422).json({
          error:
            'Please enter a valid email address.'
        });
      }

      if (!otp || otp.length !== 6) {
        return res.status(422).json({
          error:
            'Please enter the 6-digit verification code.'
        });
      }

      /*
       * Get the latest unused registration OTP
       * for the pending registration.
       */

      const [r] = await pool.query(
        `SELECT ro.*
         FROM registration_otps ro
         INNER JOIN pending_registrations pr
           ON pr.id = ro.pending_registration_id
         WHERE ro.purpose=?
           AND ro.used_at IS NULL
           AND pr.email=?
         ORDER BY ro.created_date DESC
         LIMIT 1`,
        [
          'registration',
          email
        ]
      );

      const rec = r[0];

      if (!rec) {
        return res.status(401).json({
          error:
            'Invalid verification code.'
        });
      }

      if (
        new Date(rec.expires_at) <
        new Date()
      ) {
        return res.status(401).json({
          error:
            'This verification code has expired. Please request a new code.'
        });
      }

      if (Number(rec.attempts || 0) >= MAX_OTP_ATTEMPTS) {
        return res.status(429).json({
          error: 'Too many incorrect codes. Request a new verification code.',
        });
      }

      if (
        rec.otp_hash !== sha256(otp)
      ) {
        const lockCode = Number(rec.attempts || 0) + 1 >= MAX_OTP_ATTEMPTS;
        if (lockCode) {
          await pool.query(
            `UPDATE registration_otps
             SET attempts=attempts+1, used_at=?
             WHERE id=? AND used_at IS NULL`,
            [now(), rec.id]
          );
        } else {
          await pool.query(
            `UPDATE registration_otps
             SET attempts=attempts+1
             WHERE id=? AND used_at IS NULL`,
            [rec.id]
          );
        }

        return res.status(401).json({
          error:
            'Invalid verification code.'
        });
      }

      const [pr] =
        await pool.query(
          `SELECT *
           FROM pending_registrations
           WHERE id=?
             AND email=?
           LIMIT 1`,
          [
            rec.pending_registration_id,
            email
          ]
        );

      const pending = pr[0];

      if (!pending) {
        return res.status(404).json({
          error:
            'Pending registration not found.'
        });
      }

      /*
       * Make sure account wasn't created
       * between OTP requests.
       */

      const existingUser =
        await findUserByEmail(email);

      if (existingUser) {
        return res.status(409).json({
          error:
            'An account with this email already exists.'
        });
      }

      const userId = id('user');
      const n = now();

      await pool.query(
        'START TRANSACTION'
      );

      try {

        /* Mark OTP as verified */

        await pool.query(
          `UPDATE registration_otps
           SET used_at=?,
               verified_at=?
           WHERE id=?`,
          [
            n,
            n,
            rec.id
          ]
        );

        /* Create user */

        await pool.query(
          `INSERT INTO users
          (
            id,
            created_date,
            updated_date,
            email,
            full_name,
            birth_date,
            phone,
            role,
            password_hash,
            disabled,
            is_verified,
            app_id,
            is_service,
            app_role
          )
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            userId,
            n,
            n,
            pending.email,
            pending.full_name,
            pending.birth_date,
            pending.phone,
            'guest',
            pending.password_hash,
            0,
            1,
            pending.app_id ||
              'local-kasa-ilaya',
            0,
            'guest'
          ]
        );

        /* Delete pending registration */

        await pool.query(
          `DELETE FROM pending_registrations
           WHERE id=?`,
          [pending.id]
        );

        await pool.query(
          'COMMIT'
        );

        const user =
          await findUserById(userId);

        /*
         * Automatically log the user in
         * after successful verification.
         */

        if (user) {
          await issue(res, user, req);
        }

        return res.json({
          success: true,
          user: user
            ? publicUser(user)
            : null
        });

      } catch (error) {

        await pool.query(
          'ROLLBACK'
        );

        throw error;
      }
    }

    /* =====================================================
       UPDATE PROFILE
    ===================================================== */

    if (action === 'update-me') {

      if (!req.user) {
        return res.status(401).json({
          error: 'Not authenticated.'
        });
      }

      const fields = [];
      const vals = [];

      if (Object.prototype.hasOwnProperty.call(p, 'full_name')) {
        const fullName = String(p.full_name || '').trim();
        if (!fullName || fullName.length > 120) {
          return res.status(422).json({ error: 'Enter a name using 1 to 120 characters.' });
        }
      }
      if (Object.prototype.hasOwnProperty.call(p, 'email')) {
        return res.status(409).json({ error: 'Email changes require a separate verified-email flow. Contact resort support to request an update.' });
      }
      if (Object.prototype.hasOwnProperty.call(p, 'phone')) {
        const phone = String(p.phone || '').trim();
        if (phone && !phoneOk(phone)) {
          return res.status(422).json({ error: 'Enter a valid Philippine mobile number.' });
        }
      }
      if (Object.prototype.hasOwnProperty.call(p, 'birth_date')) {
        const birthDate = String(p.birth_date || '').trim();
        if (birthDate && !validDateOnly(birthDate)) {
          return res.status(422).json({ error: 'Enter a valid birthday.' });
        }
        if (birthDate && ageFromDateOnly(birthDate) < 18) {
          return res.status(422).json({ error: 'You must be at least 18 years old.' });
        }
      }
      if (Object.prototype.hasOwnProperty.call(p, 'profile_image_url')) {
        const imageUrl = String(p.profile_image_url || '').trim();
        if (imageUrl.length > 2048 || (imageUrl && !/^(?:https?:\/\/|\/)/i.test(imageUrl))) {
          return res.status(422).json({ error: 'The profile image path is invalid.' });
        }
      }

      for (
        const f of [
          'full_name',
          'phone',
          'birth_date',
          'profile_image_url'
        ]
      ) {

        if (
          Object.prototype.hasOwnProperty.call(
            p,
            f
          )
        ) {

          fields.push(`${f}=?`);

          vals.push(f === 'full_name'
              ? String(p[f]).trim()
              : f === 'birth_date'
                ? String(p[f] || '').trim() || null
                : String(p[f] || '').trim() || null);
        }
      }

      if (!fields.length) {
        return res.json(
          req.publicUser
        );
      }

      fields.push(
        'updated_date=?'
      );

      vals.push(
        now(),
        req.user.id
      );

      await pool.query(
        `UPDATE users
         SET ${fields.join(',')}
         WHERE id=?`,
        vals
      );

      await recordAccountActivity(req.user.id, 'profile_updated', 'Updated personal account information.');

      return res.json(
        publicUser(
          await findUserById(
            req.user.id
          )
        )
      );
    }

    /* =====================================================
       CHANGE PASSWORD
    ===================================================== */

    if (action === 'change-password') {

      if (!req.user) {
        return res.status(401).json({
          error:
            'Not authenticated.'
        });
      }

      const current = String(
        p.current_password || ''
      );

      const next = String(
        p.new_password || ''
      );

      if (!req.user.password_hash) {
        return res.status(409).json({
          error: 'This account uses Google Sign-In. Password management is handled by Google.'
        });
      }

      if (!isStrongPassword(next)) {
        return res.status(422).json({
          error: 'Password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and special character.'
        });
      }

      if (
        !await bcrypt.compare(
          current,
          req.user.password_hash
        )
      ) {
        return res.status(401).json({
          error:
            'Current password is incorrect.'
        });
      }

      await pool.query(
        `UPDATE users
         SET password_hash=?,
             updated_date=?
         WHERE id=?`,
        [
          await bcrypt.hash(
            next,
            12
          ),
          now(),
          req.user.id
        ]
      );

      await pool.query(
        `UPDATE auth_sessions SET revoked_at=NOW()
         WHERE user_id=? AND id<>? AND revoked_at IS NULL`,
        [req.user.id, req.authSessionId || '']
      );
      await recordAccountActivity(req.user.id, 'password_changed', 'Changed the account password. Other devices were signed out.');

      return res.json({
        success: true
      });
    }

    /* =====================================================
       FORGOT PASSWORD / RESEND RESET OTP
    ===================================================== */

    if (
      action === 'forgot-password' ||
      action === 'resend-reset-otp'
    ) {

      const email = String(
        p.email || ''
      )
        .trim()
        .toLowerCase();

      if (!email || !emailOk(email)) {
        return res.status(422).json({
          error:
            'Please enter a valid email address.'
        });
      }

      const ipAllowed = consumeOtpIpRequest(req, 'password-reset');

      const user =
        await findUserByEmail(email);

      if (user?.password_hash && ipAllowed && !(await otpRecipientIsRateLimited('password_reset_otps', 'user_id', user.id))) {

        const otp = config.sampleResetOtp || randomOtp();
        const n = now();

        await pool.query(
          `UPDATE password_reset_otps
           SET used_at=?
           WHERE user_id=?
             AND used_at IS NULL`,
          [
            n,
            user.id
          ]
        );

        await pool.query(
          `INSERT INTO password_reset_otps
          (
            id,
            user_id,
            otp_hash,
            attempts,
            created_date,
            expires_at
          )
          VALUES (?,?,?,?,?,?)`,
          [
            id('resetotp'),
            user.id,
            sha256(otp),
            0,
            n,
            new Date(
              Date.now() + 900000
            )
              .toISOString()
              .slice(0, 19)
              .replace('T', ' ')
          ]
        );

        const mail = config.sampleResetOtp
          ? { sent: true }
          : await sendMail(
          user.email,
          'Kasa Ilaya Resort password reset code',
          `
            <p>
              Your password reset code is
              <strong>${otp}</strong>.
            </p>

            <p>
              This code expires in 15 minutes.
            </p>
          `,
          'reset'
        );

      }

      return res.json({
        success: true,
        message:
          'If the account exists, a reset code has been sent.',
        account_status: !user ? 'not_found' : user.password_hash ? 'password' : 'google_only',
        delivery_method: config.sampleResetOtp
          ? 'development'
          : 'email',
        sample_reset_otp: user?.password_hash && config.sampleResetOtp ? config.sampleResetOtp : undefined
      });
    }

    /* =====================================================
       VALIDATE RESET CODE
    ===================================================== */

    if (action === 'validate-reset-code') {

      const email = String(
        p.email || ''
      )
        .trim()
        .toLowerCase();

      const code = String(
        p.code || ''
      ).replace(/\D/g, '');

      const user =
        await findUserByEmail(email);

      if (!user?.password_hash) {
        return res.status(404).json({
          error:
            'This reset code is invalid or expired.'
        });
      }

      const [r] =
        await pool.query(
          `SELECT *
           FROM password_reset_otps
           WHERE user_id=?
             AND used_at IS NULL
           ORDER BY created_date DESC
           LIMIT 1`,
          [user.id]
        );

      const rec = r[0];

      if (
        !rec ||
        new Date(rec.expires_at) < new Date() ||
        Number(rec.attempts || 0) >= MAX_OTP_ATTEMPTS
      ) {
        return res.status(404).json({
          error:
            'This reset code is invalid or expired.'
        });
      }

      if (rec.otp_hash !== sha256(code)) {
        const lockCode = Number(rec.attempts || 0) + 1 >= MAX_OTP_ATTEMPTS;
        if (lockCode) {
          await pool.query(
            `UPDATE password_reset_otps
             SET attempts=attempts+1, used_at=?
             WHERE id=? AND used_at IS NULL`,
            [now(), rec.id]
          );
        } else {
          await pool.query(
            `UPDATE password_reset_otps
             SET attempts=attempts+1
             WHERE id=? AND used_at IS NULL`,
            [rec.id]
          );
        }
        return res.status(404).json({
          error: 'This reset code is invalid or expired.',
        });
      }

      const token =
        crypto
          .randomBytes(32)
          .toString('hex');

      await pool.query(
        `INSERT INTO password_reset_tokens
        (
          id,
          user_id,
          token_hash,
          purpose,
          attempts,
          created_date,
          expires_at
        )
        VALUES (?,?,?,?,?,?,?)`,
        [
          id('resettoken'),
          user.id,
          sha256(token),
          'reset_authorization',
          0,
          now(),
          new Date(
            Date.now() + 900000
          )
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ')
        ]
      );

      await pool.query(
        `UPDATE password_reset_otps
         SET used_at=?,
             verified_at=?
         WHERE id=?`,
        [
          now(),
          now(),
          rec.id
        ]
      );

      return res.json({
        valid: true,
        email: user.email,
        full_name: user.full_name,
        reset_token: token
      });
    }

    /* =====================================================
       RESET PASSWORD
    ===================================================== */

    if (action === 'reset-password') {

      const token = String(
        p.token ||
        p.reset_token ||
        ''
      );

      const next = String(
        p.new_password || ''
      );

      if (!token) {
        return res.status(422).json({
          error:
            'Reset authorization is required.'
        });
      }

      if (!isStrongPassword(next)) {
        return res.status(422).json({
          error: 'Password must be at least 10 characters and include an uppercase letter, lowercase letter, number, and special character.'
        });
      }

      const [r] =
        await pool.query(
          `SELECT t.*,u.email AS account_email
           FROM password_reset_tokens t
           INNER JOIN users u ON u.id=t.user_id
           WHERE t.token_hash=?
             AND t.purpose IN ('reset_authorization','account_recovery')
             AND t.used_at IS NULL
             AND u.disabled=0
             AND (t.purpose='account_recovery' OR NULLIF(TRIM(u.password_hash), '') IS NOT NULL)
             AND (t.purpose<>'account_recovery' OR EXISTS (
               SELECT 1 FROM account_recovery_requests ar
               WHERE ar.id=t.recovery_request_id AND ar.user_id=t.user_id AND ar.status='approved'
             ))
           LIMIT 1`,
          [sha256(token)]
        );

      const rec = r[0];

      if (
        !rec ||
        new Date(rec.expires_at) <
          new Date()
      ) {
        return res.status(404).json({
          error:
            'This reset authorization is invalid or expired.'
        });
      }

      if (rec.purpose === 'account_recovery') {
        const connection = await pool.getConnection();
        let recoveredEmail = '';
        let originalEmail = '';
        try {
          await connection.beginTransaction();
          const [tokens] = await connection.query(
            `SELECT t.*,u.email AS account_email,u.disabled
             FROM password_reset_tokens t INNER JOIN users u ON u.id=t.user_id
             WHERE t.id=? AND t.token_hash=? AND t.purpose='account_recovery'
               AND t.used_at IS NULL AND t.expires_at>NOW() FOR UPDATE`,
            [rec.id, sha256(token)]
          );
          const recoveryToken = tokens[0];
          if (!recoveryToken || recoveryToken.disabled) {
            await connection.rollback();
            return res.status(404).json({ error: 'This reset authorization is invalid or expired.' });
          }
          const [requests] = await connection.query(
            `SELECT * FROM account_recovery_requests
             WHERE id=? AND user_id=? AND status='approved' LIMIT 1 FOR UPDATE`,
            [recoveryToken.recovery_request_id, recoveryToken.user_id]
          );
          const recovery = requests[0];
          if (!recovery || !emailOk(recovery.requested_email)) {
            await connection.rollback();
            return res.status(404).json({ error: 'This reset authorization is invalid or expired.' });
          }
          const [emailOwners] = await connection.query(
            'SELECT id FROM users WHERE LOWER(email)=LOWER(?) AND id<>? LIMIT 1 FOR UPDATE',
            [recovery.requested_email, recoveryToken.user_id]
          );
          if (emailOwners.length) {
            await connection.rollback();
            return res.status(409).json({ error: 'This email is now connected to another account. Contact the resort for help.' });
          }
          const recoveredAt = now();
          const passwordHash = await bcrypt.hash(next, 12);
          await connection.query(
            'UPDATE users SET email=?,password_hash=?,updated_date=? WHERE id=?',
            [recovery.requested_email, passwordHash, recoveredAt, recoveryToken.user_id]
          );
          await connection.query(
            'UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL',
            [recoveredAt, recoveryToken.user_id]
          );
          await connection.query(
            `UPDATE account_recovery_requests SET status='completed',updated_date=? WHERE id=? AND status='approved'`,
            [recoveredAt, recovery.id]
          );
          await connection.query(
            'UPDATE auth_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL',
            [recoveryToken.user_id]
          );
          await connection.query(
            `INSERT INTO account_activity (id,user_id,event_type,description,created_at)
             VALUES (?,?,?,?,?)`,
            [id('account-activity'), recoveryToken.user_id, 'account_recovered', 'Updated the account email and password using an approved recovery request. All active devices were signed out.', recoveredAt]
          );
          await connection.query(
            `INSERT INTO activity_logs (id,created_date,updated_date,user_email,user_name,actor_role,action,entity_type,entity_id,details)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [id('activitylog'), recoveredAt, recoveredAt, recovery.old_email, recovery.full_name, 'system', 'Completed account recovery', 'User', recoveryToken.user_id, `Account email changed to ${recovery.requested_email} after approved recovery request ${recovery.id}; password reset and active sessions revoked.`]
          );
          await connection.commit();
          recoveredEmail = recovery.requested_email;
          originalEmail = recovery.old_email;
        } catch (error) {
          try { await connection.rollback(); } catch {}
          throw error;
        } finally {
          connection.release();
        }

        void sendMail(
          originalEmail,
          'Your Kasa Ilaya Resort account recovery was completed',
          `<p>The email address for your Kasa Ilaya Resort account was changed to <strong>${escapeAuthHtml(recoveredEmail)}</strong> after an approved recovery request.</p>
           <p>If you did not request this change, contact the resort through its official channels immediately.</p>`,
          'account_recovery_notice'
        ).catch((error) => console.error('Account recovery notice could not be sent', { code: error.code }));
        return res.json({ success: true, email_changed: true });
      }

      await pool.query(
        `UPDATE users
         SET password_hash=?,
             updated_date=?
         WHERE id=?`,
        [
          await bcrypt.hash(
            next,
            12
          ),
          now(),
          rec.user_id
        ]
      );

      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at=?
         WHERE id=?`,
        [
          now(),
          rec.id
        ]
      );

      await pool.query(
        `UPDATE auth_sessions SET revoked_at=NOW()
         WHERE user_id=? AND revoked_at IS NULL`,
        [rec.user_id]
      );
      await recordAccountActivity(rec.user_id, 'password_reset', 'Reset the account password. All active devices were signed out.');

      return res.json({
        success: true
      });
    }

    /* =====================================================
       UNKNOWN ACTION
    ===================================================== */

    return res.status(405).json({
      error:
        'Unsupported auth action.'
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;
