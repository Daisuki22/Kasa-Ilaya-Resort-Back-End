const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyPaymentProvider,
  extractAmount,
  extractDate,
  extractReceiptFields,
} = require('../src/services/receiptOcr');

test('OCR parser recognizes Philippine payment providers and currency amounts', () => {
  assert.equal(classifyPaymentProvider('GCash payment confirmation'), 'gcash');
  assert.equal(extractAmount('Amount Sent: PHP 1,050.00'), 1050);
  assert.equal(extractAmount('PHP 1,050.00'), 1050);
  assert.equal(extractAmount('1,050.00 PHP'), 1050);
});

test('OCR parser extracts date, reference, status and clamps confidence', () => {
  const result = extractReceiptFields({
    text: 'Maya\nSuccessful\nAmount: PHP 1,050.00\nReference No: ABCD123456\nDate: 2026-09-29',
    confidence: 140,
  });

  assert.equal(result.provider, 'maya');
  assert.equal(result.amount, 1050);
  assert.equal(result.reference, 'ABCD123456');
  assert.equal(result.date, '2026-09-29');
  assert.equal(result.status, 'successful');
  assert.equal(result.confidence, 100);
  assert.equal(extractDate('09/29/2026'), '2026-09-29');
  assert.equal(extractDate('2026-02-30'), null);
});

test('OCR parser extracts a labeled payment account number', () => {
  const result = extractReceiptFields({
    text: 'GCash\nAccount Number: 0917 123 4567\nAmount Sent: PHP 1,500.00\nReference No: ABCD123456',
    confidence: 94,
  });
  assert.equal(result.paymentNumber, '0917 123 4567');
});
