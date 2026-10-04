const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_PAYMENT_RECEIPT_BYTES, isValidPaymentReceiptImage } = require('../src/services/paymentReceiptFile');

test('receipt upload accepts supported image signatures and rejects unsupported or spoofed types', () => {
  assert.equal(isValidPaymentReceiptImage('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0x00])), true);
  assert.equal(isValidPaymentReceiptImage('image/gif', Buffer.from('GIF89a')), false);
  assert.equal(isValidPaymentReceiptImage('image/png', Buffer.from('not a png')), false);
});

test('receipt upload rejects files larger than the 8 MB limit', () => {
  assert.equal(MAX_PAYMENT_RECEIPT_BYTES, 8 * 1024 * 1024);
  assert.equal(isValidPaymentReceiptImage('image/jpeg', Buffer.alloc(MAX_PAYMENT_RECEIPT_BYTES + 1)), false);
});
