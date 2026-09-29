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

function createPaymentProofUploadToken({ userId, fileUrl, secret, ocr, now = Date.now(), ttlSeconds = 7200 }) {
  if (!userId || !fileUrl || !secret) throw new Error('Missing payment proof token parameters.');
  const payload = Buffer.from(JSON.stringify({
    sub: String(userId),
    purpose: 'payment_receipt',
    path: uploadPath(fileUrl),
    exp: Math.floor(now / 1000) + ttlSeconds,
    ocr: ocr ? {
      provider: typeof ocr.provider === 'string' ? ocr.provider.slice(0, 32) : null,
      amount: Number.isFinite(Number(ocr.amount)) ? Number(ocr.amount) : null,
      reference: typeof ocr.reference === 'string' ? ocr.reference.slice(0, 64) : null,
      date: typeof ocr.date === 'string' ? ocr.date.slice(0, 10) : null,
      confidence: Number.isFinite(Number(ocr.confidence)) ? Math.max(0, Math.min(100, Number(ocr.confidence))) : 0,
      status: typeof ocr.status === 'string' ? ocr.status.slice(0, 16) : 'unknown',
    } : null,
  })).toString('base64url');
  return `${payload}.${signatureFor(payload, secret)}`;
}

function getPaymentProofUploadClaims(token, { userId, fileUrl, secret, now = Date.now() }) {
  if (!token || !userId || !fileUrl || !secret) return null;
  const [payload, providedSignature, extra] = String(token).split('.');
  if (!payload || !providedSignature || extra !== undefined) return null;

  const expectedSignature = signatureFor(payload, secret);
  const expectedBytes = Buffer.from(expectedSignature);
  const providedBytes = Buffer.from(providedSignature);
  if (expectedBytes.length !== providedBytes.length || !timingSafeEqual(expectedBytes, providedBytes)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const valid = claims.sub === String(userId)
      && claims.purpose === 'payment_receipt'
      && claims.path === uploadPath(fileUrl)
      && Number(claims.exp) > Math.floor(now / 1000);
    return valid ? claims : null;
  } catch {
    return null;
  }
}

const verifyPaymentProofUploadToken = (token, options) => Boolean(getPaymentProofUploadClaims(token, options));

module.exports = { createPaymentProofUploadToken, getPaymentProofUploadClaims, verifyPaymentProofUploadToken };
