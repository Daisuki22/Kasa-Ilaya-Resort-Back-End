const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  ssl: config.db.ssl ? { minVersion: 'TLSv1.2' } : undefined,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  enableKeepAlive: true,
  connectTimeout: 15000
});

async function testConnection(){ const c=await pool.getConnection(); try { await c.query('SELECT 1'); return true; } finally { c.release(); } }
async function tableExists(table){const [r]=await pool.query('SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?',[table]);return Number(r[0]?.count||0)>0;}
async function columnExists(table,column){const [r]=await pool.query('SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',[table,column]);return Number(r[0]?.count||0)>0;}
async function indexExists(table,indexName){const [r]=await pool.query('SELECT COUNT(*) AS count FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=?',[table,indexName]);return Number(r[0]?.count||0)>0;}
async function addColumnIfMissing(table,column,definition){if(!await columnExists(table,column))await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);}
async function ensurePaymentQrCodeImageCapacity(){
  if(!await tableExists('payment_qr_codes'))return;
  const [rows]=await pool.query('SELECT data_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=? LIMIT 1',['payment_qr_codes','image_url']);
  const dataType=String(rows[0]?.data_type||'').toLowerCase();
  if(dataType&&!['mediumtext','longtext'].includes(dataType))await pool.query('ALTER TABLE `payment_qr_codes` MODIFY COLUMN `image_url` MEDIUMTEXT NOT NULL');
}
async function ensureRuntimeSchema(){
  if(await tableExists('bookings')){
    await addColumnIfMissing('bookings','included_guest_count','included_guest_count INT NOT NULL DEFAULT 1 AFTER guest_count');
  }
  if(await tableExists('notifications')){
    await addColumnIfMissing('notifications','actor_name','actor_name VARCHAR(191) NULL AFTER entity_id');
    await addColumnIfMissing('notifications','actor_profile_image_url','actor_profile_image_url VARCHAR(1024) NULL AFTER actor_name');
    await pool.query(`UPDATE notifications n
      LEFT JOIN bookings b ON b.id=n.entity_id AND n.entity_type='Booking'
      LEFT JOIN users u ON LOWER(u.email)=LOWER(b.customer_email)
      SET n.actor_name=COALESCE(u.full_name,b.customer_name,'Guest'),
          n.actor_profile_image_url=u.profile_image_url
      WHERE n.entity_type='Booking' AND n.actor_name IS NULL AND n.entity_id IS NOT NULL`);
  }
  if(!await tableExists('payment_proof_uploads')){
    await pool.query(`CREATE TABLE payment_proof_uploads (
      file_url VARCHAR(255) NOT NULL PRIMARY KEY,
      mime_type VARCHAR(32) NOT NULL,
      image_data MEDIUMBLOB NOT NULL,
      created_at DATETIME NOT NULL,
      KEY idx_payment_proof_uploads_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  }
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
async function ensureAccountSettingsSchema(){
  if(!await tableExists('auth_sessions')){
    await pool.query(`CREATE TABLE auth_sessions (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      token_fingerprint CHAR(64) NULL,
      user_agent VARCHAR(512) NULL,
      ip_address VARCHAR(45) NULL,
      location VARCHAR(191) NULL,
      created_at DATETIME NOT NULL,
      last_seen_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      KEY idx_auth_sessions_user (user_id),
      KEY idx_auth_sessions_expiry (expires_at),
      UNIQUE KEY idx_auth_sessions_token_fingerprint (token_fingerprint)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  }
  await addColumnIfMissing('auth_sessions','token_fingerprint','token_fingerprint CHAR(64) NULL');
  await addColumnIfMissing('auth_sessions','device_fingerprint','device_fingerprint CHAR(64) NULL AFTER user_agent');
  await addColumnIfMissing('auth_sessions','ip_address','ip_address VARCHAR(45) NULL AFTER user_agent');
  await addColumnIfMissing('auth_sessions','location','location VARCHAR(191) NULL AFTER ip_address');
  if(!await indexExists('auth_sessions','idx_auth_sessions_token_fingerprint')){
    await pool.query('ALTER TABLE auth_sessions ADD UNIQUE KEY idx_auth_sessions_token_fingerprint (token_fingerprint)');
  }
  if(!await indexExists('auth_sessions','idx_auth_sessions_user_device')){
    await pool.query('ALTER TABLE auth_sessions ADD KEY idx_auth_sessions_user_device (user_id, device_fingerprint)');
  }
  if(!await tableExists('account_activity')){
    await pool.query(`CREATE TABLE account_activity (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      event_type VARCHAR(48) NOT NULL,
      description VARCHAR(255) NOT NULL,
      created_at DATETIME NOT NULL,
      KEY idx_account_activity_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  }
}
module.exports={pool,testConnection,ensureRuntimeSchema,ensurePaymentQrCodeImageCapacity,ensureAccountSettingsSchema};
