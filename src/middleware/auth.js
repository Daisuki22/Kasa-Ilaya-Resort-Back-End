const jwt = require('jsonwebtoken');
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
    if (!claims.sid || !claims.sub) {
      req.user = null;
      return next();
    }

    const [sessions] = await pool.query(
      `SELECT id FROM auth_sessions
       WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>NOW()
       LIMIT 1`,
      [String(claims.sid), String(claims.sub)]
    );
    if (!sessions[0]) {
      req.user = null;
      return next();
    }

    const user = await findUserById(claims.sub);
    if (!user || user.disabled) {
      req.user = null;
      return next();
    }

    req.user = user;
    req.publicUser = publicUser(user);
    req.authSessionId = String(claims.sid);
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
