require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 10000),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  db: {
    host: required("KASA_DB_HOST"),
    port: Number(process.env.KASA_DB_PORT || 4000),
    database: required("KASA_DB_NAME"),
    user: required("KASA_DB_USER"),
    password: required("KASA_DB_PASS")
  }
};
