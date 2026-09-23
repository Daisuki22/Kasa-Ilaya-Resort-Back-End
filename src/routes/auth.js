const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/database");
const config = require("../config/env");
const { id } = require("../utils/id");

const router = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    birth_date: user.birth_date,
    phone: user.phone,
    profile_image_url: user.profile_image_url,
    role: user.role,
    is_verified: !!user.is_verified,
    app_id: user.app_id,
    app_role: user.app_role
  };
}

router.post("/register", async (req, res, next) => {
  try {
    const { email, full_name, birth_date = null, phone = null, password } = req.body;

    if (!email || !full_name || !password) {
      return res.status(400).json({
        success: false,
        message: "email, full_name and password are required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters."
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userId = id();

    await pool.query(
      `INSERT INTO users
       (id, created_date, updated_date, email, full_name, birth_date, phone,
        role, password_hash, is_verified, app_id, is_service, app_role)
       VALUES (?, NOW(), NOW(), ?, ?, ?, ?, 'guest', ?, 1, 'local-kasa-ilaya', 0, 'guest')`,
      [userId, normalizedEmail, full_name, birth_date, phone, passwordHash]
    );

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    res.status(201).json({
      success: true,
      user: publicUser(rows[0])
    });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? LIMIT 1",
      [normalizedEmail]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const user = rows[0];

    if (user.disabled) {
      return res.status(403).json({
        success: false,
        message: "This account is disabled."
      });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        message: "This account does not have a password configured."
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    await pool.query(
      "UPDATE users SET last_login_at = NOW(), updated_date = NOW() WHERE id = ?",
      [user.id]
    );

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        full_name: user.full_name
      },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      success: true,
      token,
      user: publicUser(user)
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
