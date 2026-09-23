const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.name,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  waitForConnections: true, connectionLimit: 10, queueLimit: 0, enableKeepAlive: true, connectTimeout: 15000
});

async function testConnection(){ const c=await pool.getConnection(); try { await c.query('SELECT 1'); return true; } finally { c.release(); } }
module.exports={pool,testConnection};
