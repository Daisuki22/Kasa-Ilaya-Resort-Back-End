const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.name,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  waitForConnections: true, connectionLimit: 10, queueLimit: 0, enableKeepAlive: true, connectTimeout: 15000
});

async function testConnection(){ const c=await pool.getConnection(); try { await c.query('SELECT 1'); return true; } finally { c.release(); } }
async function tableExists(table){const [r]=await pool.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',[table]);return Number(r[0]?.count||0)>0;}
async function columnExists(table,column){const [r]=await pool.query('SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',[table,column]);return Number(r[0]?.count||0)>0;}
async function indexExists(table,indexName){const [r]=await pool.query('SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?',[table,indexName]);return Number(r[0]?.count||0)>0;}
async function addColumnIfMissing(table,column,definition){if(!await columnExists(table,column))await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);}
async function ensureRuntimeSchema(){
  if(await tableExists('pending_registrations')&&!await indexExists('pending_registrations','pending_registrations_email_unique')){
    await pool.query('ALTER TABLE pending_registrations ADD UNIQUE KEY pending_registrations_email_unique (email)');
  }
  if(await tableExists('registration_otps')){
    await addColumnIfMissing('registration_otps','purpose',"purpose VARCHAR(32) NOT NULL DEFAULT 'registration' AFTER otp_hash");
    await addColumnIfMissing('registration_otps','attempts','attempts INT NOT NULL DEFAULT 0 AFTER purpose');
    await addColumnIfMissing('registration_otps','verified_at','verified_at DATETIME NULL AFTER used_at');
  }
  if(await tableExists('password_reset_tokens')){
    await addColumnIfMissing('password_reset_tokens','purpose',"purpose VARCHAR(32) NOT NULL DEFAULT 'reset_authorization' AFTER token_hash");
    await addColumnIfMissing('password_reset_tokens','attempts','attempts INT NOT NULL DEFAULT 0 AFTER purpose');
  }
  if(!await tableExists('password_reset_otps')){
    await pool.query(`CREATE TABLE password_reset_otps (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      otp_hash VARCHAR(64) NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_date DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      verified_at DATETIME NULL,
      KEY idx_password_reset_otps_user (user_id),
      KEY idx_password_reset_otps_created (created_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  }
}
module.exports={pool,testConnection,ensureRuntimeSchema};
