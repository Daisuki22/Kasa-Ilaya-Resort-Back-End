const { createHmac, timingSafeEqual } = require('node:crypto');

const uploadPath = (value) => {
  try {
    return new URL(String(value || ''), 'http://local.invalid').pathname;
  } catch {
    return '';
  }
};

const signatureFor = (payload, secret) => createHmac('sha256', secret)
  .update(payload)
  .digest('base64url');

function createPaymentProofUploadToken({ userId, fileUrl, secret, now = Date.now(), ttlSeconds = 7200 }) {
  if (!userId || !fileUrl || !secret) throw new Error('Missing payment proof token parameters.');
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    purpose: 'payment_receipt',
    path: uploadPath(fileUrl),
    exp: Math.floor(now / 1000) + ttlSeconds,
  })).toString('base64url');
  return `${payload}.${signatureFor(payload, secret)}`;
}

function verifyPaymentProofUploadToken(token, { userId, fileUrl, secret, now = Date.now() }) {
  if (!token || !userId || !fileUrl || !secret) return false;
  const [payload, providedSignature, extra] = String(token).split('.');
  if (!payload || !providedSignature || extra !== undefined) return false;

  const expectedSignature = signatureFor(payload, secret);
  const expectedBytes = Buffer.from(expectedSignature);
  const providedBytes = Buffer.from(providedSignature);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) return false;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.sub === String(userId)
      && claims.purpose === 'payment_receipt'
      && claims.path === uploadPath(fileUrl)
      && Number(claims.exp) > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

module.exports = { createPaymentProofUploadToken, verifyPaymentProofUploadToken };
