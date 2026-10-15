require('dotenv').config();

const required = ['JWT_SECRET','KASA_DB_HOST','KASA_DB_PORT','KASA_DB_NAME','KASA_DB_USER','KASA_DB_PASS'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);

const defaultGoogleClientId = '834800627360-tj8514jf4tqk46oodm358bu9thvub21f.apps.googleusercontent.com';
const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const googleClientId = process.env.KASA_GOOGLE_CLIENT_ID
  || process.env.GOOGLE_CLIENT_ID
  || defaultGoogleClientId;
const mail = {
  enabled: /^(1|true|yes)$/i.test(process.env.KASA_MAIL_ENABLED || 'false'),
  host: process.env.KASA_SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.KASA_SMTP_PORT || 2525),
  user: process.env.KASA_SMTP_USER || '',
  pass: process.env.KASA_SMTP_PASS || '',
  from: process.env.KASA_MAIL_FROM_EMAIL || '',
  fromName: process.env.KASA_MAIL_FROM_NAME || 'Kasa Ilaya Resort',
  admin: process.env.KASA_ADMIN_NOTIFICATION_EMAIL || ''
};

if (mail.enabled) {
  const requiredMailSettings = [
    ['KASA_SMTP_HOST', mail.host],
    ['KASA_SMTP_USER', mail.user],
    ['KASA_SMTP_PASS', mail.pass],
    ['KASA_MAIL_FROM_EMAIL', mail.from]
  ];
  for (const [key, value] of requiredMailSettings) {
    if (!value) throw new Error(`Missing required email environment variable: ${key}`);
  }
  if (!Number.isInteger(mail.port) || mail.port < 1 || mail.port > 65535) {
    throw new Error('KASA_SMTP_PORT must be an integer from 1 to 65535.');
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail.from)) {
    throw new Error('KASA_MAIL_FROM_EMAIL must be a valid, Brevo-verified sender address.');
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 10000),
  frontendUrl: process.env.FRONTEND_URL || '',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  sampleRegistrationOtp: !isProduction
    ? (/^\d{6}$/.test(process.env.KASA_SAMPLE_REGISTRATION_OTP || '')
      ? process.env.KASA_SAMPLE_REGISTRATION_OTP
      : '123456')
    : '',
  sampleResetOtp: !isProduction
    ? (/^\d{6}$/.test(process.env.KASA_SAMPLE_RESET_OTP || '')
      ? process.env.KASA_SAMPLE_RESET_OTP
      : '123456')
    : '',
  db: {
    host: process.env.KASA_DB_HOST,
    port: Number(process.env.KASA_DB_PORT || 4000),
    name: process.env.KASA_DB_NAME,
    user: process.env.KASA_DB_USER,
    password: process.env.KASA_DB_PASS,
    ssl: /^(1|true|yes)$/i.test(process.env.KASA_DB_SSL || ((process.env.NODE_ENV || 'development') === 'production' ? 'true' : 'false'))
  },
  mail,
  googleClientId
};
