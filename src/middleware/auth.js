const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const config = require('../config/env');
const { pool } = require('../config/database');
const { findUserById, publicUser } = require('../utils');

function tokenFrom(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.kasa_token) return req.cookies.kasa_token;
  return null;
}

async function auth(req, res, next) {
  try {
    const token = tokenFrom(req);
    if (!token) {
      req.user = null;
      return next();
    }

    const claims = jwt.verify(token, config.jwtSecret);
    if (!claims.sub) {
      req.user = null;
      return next();
    }

    const user = await findUserById(claims.sub);
    if (!user || user.disabled) {
      req.user = null;
      return next();
    }

    let sessionId = claims.sid ? String(claims.sid) : '';
    let [sessions] = sessionId
      ? await pool.query(
        `SELECT id FROM auth_sessions
         WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>NOW()
         LIMIT 1`,
        [sessionId, String(claims.sub)]
      )
      : [ [] ];

    // Existing, unexpired cookies predate session IDs. Fingerprint the original
    // JWT so it can be adopted once and still revoked if this device is signed out.
    if (!claims.sid) {
      const fingerprint = crypto.createHash('sha256').update(token).digest('hex');
      const [legacySessions] = await pool.query(
        `SELECT id, revoked_at, expires_at FROM auth_sessions
         WHERE token_fingerprint=? AND user_id=? LIMIT 1`,
        [fingerprint, String(claims.sub)]
      );
      if (legacySessions[0]) {
        if (legacySessions[0].revoked_at || new Date(legacySessions[0].expires_at) <= new Date()) {
          req.user = null;
          return next();
        }
        sessionId = legacySessions[0].id;
        sessions = [{ id: sessionId }];
      } else {
        sessionId = crypto.randomUUID();
        const expiresAt = new Date(Number(claims.exp || 0) * 1000);
        if (!claims.exp || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
          req.user = null;
          return next();
        }
        const [insert] = await pool.query(
          `INSERT IGNORE INTO auth_sessions
           (id,user_id,token_fingerprint,user_agent,created_at,last_seen_at,expires_at)
           VALUES (?,?,?,?,NOW(),NOW(),?)`,
          [sessionId, String(claims.sub), fingerprint, String(req.get('user-agent') || '').slice(0, 512) || null, expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
        );
        const [adopted] = await pool.query(
          `SELECT id, revoked_at, expires_at FROM auth_sessions
           WHERE token_fingerprint=? AND user_id=? LIMIT 1`,
          [fingerprint, String(claims.sub)]
        );
        if (!adopted[0] || adopted[0].revoked_at || new Date(adopted[0].expires_at) <= new Date()) {
          req.user = null;
          return next();
        }
        sessionId = adopted[0].id;
        sessions = [{ id: sessionId }];
        if (insert.affectedRows) {
          await pool.query(
            `INSERT INTO account_activity (id,user_id,event_type,description,created_at)
             VALUES (?,?, 'session_tracking_enabled', ?, NOW())`,
            [`account-activity-${crypto.randomUUID()}`, String(claims.sub), 'This device was added to session tracking.']
          );
        }
        const remainingSeconds = Math.max(1, Number(claims.exp) - Math.floor(Date.now() / 1000));
        const upgradedToken = jwt.sign(
          { sub: user.id, role: user.role, app_role: user.app_role, sid: sessionId },
          config.jwtSecret,
          { expiresIn: remainingSeconds }
        );
        res.cookie?.('kasa_token', upgradedToken, {
          httpOnly: true,
          secure: config.nodeEnv === 'production',
          sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
          path: '/api',
          maxAge: remainingSeconds * 1000
        });
      }
    }

    if (!sessions[0]) {
      req.user = null;
      return next();
    }

    req.user = user;
    req.publicUser = publicUser(user);
    req.authSessionId = sessionId;
    await pool.query(
      `UPDATE auth_sessions SET last_seen_at=NOW()
       WHERE id=? AND last_seen_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      [req.authSessionId]
    );
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      req.user = null;
      return next();
    }
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !['admin', 'super_admin'].includes(req.user.role || req.user.app_role)) {
    return res.status(403).json({ error: 'Forbidden.' });
  }
  next();
}

module.exports = { auth, requireAuth, requireAdmin };
