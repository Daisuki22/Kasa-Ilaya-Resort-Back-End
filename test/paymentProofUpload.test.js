const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentProofUploadToken, verifyPaymentProofUploadToken } = require('../src/services/paymentProofUpload');

const input = {
  userId: 'customer-42',
  fileUrl: '/uploads/2026/09/upload_abc123.jpg',
  secret: 'unit-test-secret',
  now: Date.UTC(2026, 8, 29, 0, 0, 0),
};

test('payment proof upload token is valid for the uploading customer and exact uploaded file', () => {
  const token = createPaymentProofUploadToken(input);

  assert.equal(verifyPaymentProofUploadToken(token, input), true);
  assert.equal(verifyPaymentProofUploadToken(token, { ...input, userId: 'another-customer' }), false);
  assert.equal(verifyPaymentProofUploadToken(token, { ...input, fileUrl: '/uploads/2026/09/other.jpg' }), false);
});

test('payment proof upload token rejects tampering and expiration', () => {
  const token = createPaymentProofUploadToken({ ...input, ttlSeconds: 60 });
  const [payload, signature] = token.split('.');

  assert.equal(verifyPaymentProofUploadToken(`${payload}x.${signature}`, input), false);
  assert.equal(verifyPaymentProofUploadToken(token, { ...input, now: input.now + 61_000 }), false);
});
