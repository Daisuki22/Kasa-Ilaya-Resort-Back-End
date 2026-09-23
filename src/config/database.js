const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.KASA_DB_HOST,
  port: Number(process.env.KASA_DB_PORT || 4000),
  user: process.env.KASA_DB_USER,
  password: process.env.KASA_DB_PASS,
  database: process.env.KASA_DB_NAME,

  ssl: {
    minVersion: "TLSv1.2",
    rejectUnauthorized: true
  },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true
});

async function testConnection() {
  let connection;

  try {
    connection = await pool.getConnection();

    await connection.query("SELECT 1");

    console.log("✅ TiDB database connected successfully");

    return true;
  } catch (error) {
    console.error("❌ TiDB database connection failed:");
    console.error(error.message);

    return false;
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

module.exports = {
  pool,
  testConnection
};