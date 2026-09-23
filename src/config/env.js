require('dotenv').config();

const required = ['JWT_SECRET','KASA_DB_HOST','KASA_DB_PORT','KASA_DB_NAME','KASA_DB_USER','KASA_DB_PASS'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);

const defaultGoogleClientId = '834800627360-tj8514jf4tqk46oodm358bu9thvub21f.apps.googleusercontent.com';
const googleClientId = process.env.KASA_GOOGLE_CLIENT_ID
  || process.env.GOOGLE_CLIENT_ID
  || process.env.VITE_GOOGLE_CLIENT_ID
  || defaultGoogleClientId;

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 10000),
  frontendUrl: process.env.FRONTEND_URL || '',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  db: {host:process.env.KASA_DB_HOST, port:Number(process.env.KASA_DB_PORT||4000), name:process.env.KASA_DB_NAME, user:process.env.KASA_DB_USER, password:process.env.KASA_DB_PASS},
  mail: {enabled:/^(1|true|yes)$/i.test(process.env.KASA_MAIL_ENABLED||'false'), host:process.env.KASA_SMTP_HOST||'smtp.gmail.com', port:Number(process.env.KASA_SMTP_PORT||587), user:process.env.KASA_SMTP_USER||'', pass:process.env.KASA_SMTP_PASS||'', from:process.env.KASA_MAIL_FROM_EMAIL||process.env.KASA_SMTP_USER||'', fromName:process.env.KASA_MAIL_FROM_NAME||'Kasa Ilaya Resort & Event Place', admin:process.env.KASA_ADMIN_NOTIFICATION_EMAIL||''},
  googleClientId
};
