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

const router = express.Router();

/* =========================================================
   VALIDATION HELPERS
========================================================= */

const emailOk = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

const phoneOk = (phone) =>
  /^(09\d{9}|639\d{9})$/.test(
    String(phone || '').replace(/\D/g, '')
  );

/* =========================================================
   AUTH TOKEN
========================================================= */

function issue(res, user) {
  const token = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      app_role: user.app_role
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn
    }
  );

  res.cookie?.('kasa_token', token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'none',
    maxAge: 7 * 86400000
  });

  return token;
}

/* =========================================================
   CAPTCHA
========================================================= */

function captcha() {
  const a = crypto.randomInt(2, 13);
  const b = crypto.randomInt(1, 10);
  const op = crypto.randomInt(0, 2) ? '+' : '-';

  const x = op === '-' && b > a ? b : a;
  const y = op === '-' && b > a ? a : b;

  return {
    question: `${x} ${op} ${y}`,
    answer: op === '+' ? x + y : x - y
  };
}

const captchaStore = new Map();

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

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
      credential
    )}`
  );

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

    /* ---------- GOOGLE CONFIG ---------- */

    if (action === 'google-config') {
      return res.json({
        enabled: !!config.googleClientId,
        client_id: config.googleClientId || null
      });
    }

    /* ---------- FIREBASE CONFIG ---------- */

    if (action === 'firebase-config') {
      return res.json({
        enabled: false
      });
    }

    /* ---------- CAPTCHA ---------- */

    if (action === 'captcha-challenge') {
      const purpose = [
        'login',
        'register',
        'reset'
      ].includes(req.query.purpose)
        ? req.query.purpose
        : 'login';

      const c = captcha();

      const key = `${req.ip}:${purpose}`;

      captchaStore.set(key, {
        ...c,
        expires: Date.now() + 600000
      });

      return res.json({
        success: true,
        purpose,
        question: c.question,
        expires_in_seconds: 600
      });
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
    const action = req.query.action || '';
    const p = req.body || {};

    /* =====================================================
       CAPTCHA VERIFY
    ===================================================== */

    if (action === 'verify-captcha') {
      const purpose = [
        'login',
        'register',
        'reset'
      ].includes(p.purpose)
        ? p.purpose
        : 'login';

      const key = `${req.ip}:${purpose}`;

      const c = captchaStore.get(key);

      if (!c || c.expires < Date.now()) {
        return res.status(422).json({
          success: false,
          verified: false,
          error: 'Captcha expired. Please request a new challenge.'
        });
      }

      if (Number(p.answer) !== c.answer) {
        return res.status(422).json({
          success: false,
          verified: false,
          error: 'Captcha answer is incorrect.'
        });
      }

      captchaStore.delete(key);

      req.app.locals.captchaVerified ??= new Map();

      req.app.locals.captchaVerified.set(
        `${req.ip}:${purpose}`,
        Date.now() + 600000
      );

      return res.json({
        success: true,
        verified: true,
        purpose,
        expires_in_seconds: 600
      });
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

      issue(res, user);

      return res.json({
        success: true,
        next_url: p.next_url || '/',
        user: publicUser(user)
      });
    }

    /* =====================================================
       GOOGLE LOGIN
    ===================================================== */

    if (action === 'google-login') {
      const credential = String(
        p.credential || ''
      ).trim();

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
        return res.status(401).json({
          error: 'Google account email is invalid.'
        });
      }

      let user = await findUserByEmail(email);

      if (user?.disabled) {
        return res.status(403).json({
          error: 'This account is disabled.'
        });
      }

      if (!user) {
        const birthDate = String(
          p.birth_date || ''
        ).trim();

        const age = ageFromDate(birthDate);

        if (age === null) {
          return res.status(403).json({
            error:
              'Please create an account with your birthday before signing in with Google.',
            code: 'birthday_required'
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

        const n = now();

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
            id('user'),
            n,
            n,
            email,
            fullName,
            birthDate,
            p.phone || null,
            'guest',
            null,
            0,
            1,
            'local-kasa-ilaya',
            0,
            'guest'
          ]
        );

        user = await findUserByEmail(email);

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

      issue(res, user);

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
      res.clearCookie('kasa_token');

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

      if (password.length < 8) {
        return res.status(422).json({
          error:
            'Password must be at least 8 characters.'
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

      const otp = randomOtp();

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

      const mail = await sendMail(
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
        verification_provider: 'server'
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

      const otp = randomOtp();

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

      const mail = await sendMail(
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
        verification_provider: 'server'
      });
    }

    /* =====================================================
       VERIFY REGISTRATION OTP
    ===================================================== */

    if (action === 'verify-registration-otp') {

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

      if (
        rec.otp_hash !== sha256(otp)
      ) {
        /*
         * Increment failed attempts
         */

        await pool.query(
          `UPDATE registration_otps
           SET attempts=attempts+1
           WHERE id=?`,
          [rec.id]
        );

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
          issue(res, user);
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

      for (
        const f of [
          'full_name',
          'email',
          'phone',
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

          vals.push(
            f === 'email'
              ? String(p[f])
                  .trim()
                  .toLowerCase()
              : p[f] || null
          );
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

      if (next.length < 8) {
        return res.status(422).json({
          error:
            'Password must be at least 8 characters.'
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

      const user =
        await findUserByEmail(email);

      if (user) {

        const otp = randomOtp();
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

        const mail = await sendMail(
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

        if (mail.sent === false) {
          return res.status(502).json({
            error: `Password reset email could not be sent. ${mail.error || 'Please check SMTP settings.'}`,
            mail_sent: false
          });
        }
      }

      return res.json({
        success: true,
        message:
          'If the account exists, a reset code has been sent.',
        delivery_method: 'email'
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

      if (!user) {
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
        new Date(rec.expires_at) <
          new Date() ||
        rec.otp_hash !== sha256(code)
      ) {
        return res.status(404).json({
          error:
            'This reset code is invalid or expired.'
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

      if (next.length < 8) {
        return res.status(422).json({
          error:
            'Password must be at least 8 characters.'
        });
      }

      const [r] =
        await pool.query(
          `SELECT *
           FROM password_reset_tokens
           WHERE token_hash=?
             AND used_at IS NULL
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
