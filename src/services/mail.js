const nodemailer = require('nodemailer');
const config = require('../config/env');
const { renderBrandedEmail } = require('./emailTemplate');

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

  // Do not return raw provider responses or SMTP server details to callers.
  return 'Email delivery failed. Check the Brevo sender verification and transactional email status.';
}

function getTransporter() {
  if (!config.mail.enabled) {
    return {
      error: 'Mail delivery is disabled. Set KASA_MAIL_ENABLED=true.'
    };
  }

  if (!config.mail.host || !Number.isInteger(config.mail.port) || config.mail.port < 1 || config.mail.port > 65535) {
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

  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.mail.from)) {
    return {
      error:
        'A valid sender email is required. Set KASA_MAIL_FROM_EMAIL to a Brevo-verified sender address.'
    };
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: Number(config.mail.port),

      // Brevo SMTP port 2525 uses STARTTLS and is available on Render Free.
      secure: false,
      requireTLS: true,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,

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
      html: renderBrandedEmail(subject, html)
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
