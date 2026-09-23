const nodemailer = require('nodemailer');
const config = require('../config/env');

let transporter = null;

function publicMailError(error) {
  if (!error) {
    return 'Email delivery failed.';
  }

  if (error.code === 'EAUTH' || error.responseCode === 535) {
    return 'SMTP authentication failed. Check KASA_SMTP_USER and KASA_SMTP_PASS in Render.';
  }

  if (
    error.code === 'ECONNECTION' ||
    error.code === 'ETIMEDOUT' ||
    error.code === 'ECONNREFUSED'
  ) {
    return 'Unable to connect to the SMTP server. Check KASA_SMTP_HOST and KASA_SMTP_PORT.';
  }

  return error.message || 'Email delivery failed.';
}

function getTransporter() {
  if (!config.mail.enabled) {
    return {
      error: 'Mail delivery is disabled. Set KASA_MAIL_ENABLED=true.'
    };
  }

  if (!config.mail.host || !config.mail.port) {
    return {
      error:
        'Mail server is not configured. Set KASA_SMTP_HOST and KASA_SMTP_PORT.'
    };
  }

  if (!config.mail.user || !config.mail.pass) {
    return {
      error:
        'SMTP credentials are not configured. Set KASA_SMTP_USER and KASA_SMTP_PASS.'
    };
  }

  if (!config.mail.from) {
    return {
      error:
        'Sender email is not configured. Set KASA_MAIL_FROM_EMAIL.'
    };
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: Number(config.mail.port),

      // Brevo SMTP port 587 uses STARTTLS
      secure: false,
      requireTLS: true,

      auth: {
        user: config.mail.user,
        pass: config.mail.pass
      }
    });
  }

  return { transporter };
}

async function sendMail(
  to,
  subject,
  html,
  purpose = 'main'
) {
  const setup = getTransporter();

  if (setup.error) {
    return {
      sent: false,
      error: setup.error,
      purpose
    };
  }

  try {
    const info = await setup.transporter.sendMail({
      from: `"${config.mail.fromName || 'Kasa Ilaya Resort'}" <${config.mail.from}>`,
      to,
      subject,
      html
    });

    console.log(
      `Email sent successfully: ${info.messageId || 'message accepted'}`
    );

    return {
      sent: true,
      purpose
    };
  } catch (error) {
    const safeError = publicMailError(error);

    console.error('Email delivery failed:', safeError);

    return {
      sent: false,
      error: safeError,
      purpose
    };
  }
}

module.exports = {
  sendMail
};