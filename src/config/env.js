require("dotenv").config();

const required = [
  "JWT_SECRET",
  "KASA_DB_HOST",
  "KASA_DB_PORT",
  "KASA_DB_NAME",
  "KASA_DB_USER",
  "KASA_DB_PASS"
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 10000),

  frontendUrl: process.env.FRONTEND_URL || "*",

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",

  database: {
    host: process.env.KASA_DB_HOST,
    port: Number(process.env.KASA_DB_PORT || 4000),
    name: process.env.KASA_DB_NAME,
    user: process.env.KASA_DB_USER,
    password: process.env.KASA_DB_PASS
  }
};