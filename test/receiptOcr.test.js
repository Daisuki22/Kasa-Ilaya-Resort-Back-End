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
  assert.equal(extractAmount('You sent ₱15,000.00'), 15000);
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

test('OCR parses a GCash Express Send receipt with an inline date and misread peso sign', () => {
  const result = extractReceiptFields({
    text: 'Express Send\nMe CHeeoooe A S.\n+63 Gee 000 8271\nSent via GCash\nAmount $7,000.00\nTotal Amount Sent $7,000.00\nRef No. 2354 5652 2642 Oct 21,2026 10:56 AM',
    confidence: 80,
  });

  assert.equal(result.provider, 'gcash');
  assert.equal(result.amount, 7000);
  assert.equal(result.amountCurrency, 'PHP');
  assert.equal(result.phpEquivalent, 7000);
  assert.equal(result.reference, '235456522642');
  assert.equal(result.date, '2026-10-21');
  assert.equal(result.status, 'successful');
});

test('OCR parser extracts a labeled payment account number', () => {
  const result = extractReceiptFields({
    text: 'GCash\nAccount Number: 0917 123 4567\nAmount Sent: PHP 1,500.00\nReference No: ABCD123456',
    confidence: 94,
  });
  assert.equal(result.paymentNumber, '0917 123 4567');
});

test('OCR keeps a PayPal USD charge and its printed peso equivalent separate', () => {
  const result = extractReceiptFields({
    text: 'PayPal\nAmount: $24.04\nPaid with VISA Debit Card\nPHP 7,000.00\nYour exchange rate: PHP 1.00 = $0.02\nTransaction ID: 89X62941W33447823\nDate: Oct 12, 2026',
    confidence: 96,
  });

  assert.equal(result.amount, 24.04);
  assert.equal(result.amountCurrency, 'USD');
  assert.equal(result.phpEquivalent, 7000);
  assert.equal(result.reference, '89X62941W33447823');
});

test('OCR marks an authorization screen as pending instead of a completed receipt', () => {
  const result = extractReceiptFields({
    text: 'PayPal\nPaid with VISA Debit Card\nYou will authorize Weverse Shop to charge your PayPal account\nTransaction ID: 89X62941W33447823',
    confidence: 96,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.recipient, 'Weverse Shop');
});

test('OCR distinguishes an image with no payment or receipt details', () => {
  const result = extractReceiptFields({ text: '', confidence: 31 });
  assert.equal(result.receiptLike, false);
});

test('OCR marks text with payment details as receipt-like even when some fields are missing', () => {
  const result = extractReceiptFields({ text: 'GCash payment successful', confidence: 55 });
  assert.equal(result.receiptLike, true);
});
