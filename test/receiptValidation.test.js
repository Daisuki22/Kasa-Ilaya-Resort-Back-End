const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReceiptSignals } = require('../src/services/receiptValidation');

const base = {
  requiredAmount: 1500,
  selectedMethod: 'PayPal Account',
  submittedPaymentNumber: '09171234567',
  submittedReference: 'PAY-123456',
  latestAllowedDate: '2026-10-04',
};
const validReceipt = {
  provider: 'paypal',
  amount: 1500,
  paymentNumber: '09171234567',
  reference: 'PAY-123456',
  date: '2026-10-04',
  confidence: 95,
  status: 'successful',
};

test('matching amount, method, date and reference remain eligible for manual admin review', () => {
  const result = validateReceiptSignals({ ...base, ocr: validReceipt });
  assert.equal(result.declineReason, null);
  assert.equal(result.paymentNumber, '09171234567');
  assert.equal(result.paymentReference, 'PAY-123456');
});

test('receipt date equal to the latest allowed local date passes the date check', () => {
  const result = validateReceiptSignals({ ...base, ocr: { ...validReceipt, date: '2026-10-04' } });
  assert.equal(result.date, '2026-10-04');
  assert.equal(result.declineReason, null);
});

test('a confidently mismatched receipt amount is declined', () => {
  const result = validateReceiptSignals({ ...base, ocr: { ...validReceipt, amount: 1000 } });
  assert.equal(result.declineReason, 'Payment amount does not match required amount.');
});

test('a confidently mismatched payment method is declined', () => {
  const result = validateReceiptSignals({ ...base, ocr: { ...validReceipt, provider: 'gcash' } });
  assert.equal(result.declineReason, 'Payment method does not match selected payment method.');
});

test('a confidently detected recipient account mismatch is declined', () => {
  const result = validateReceiptSignals({
    ...base,
    expectedAccountNumber: '09170000000',
    ocr: { ...validReceipt, recipient: '09179999999' },
  });
  assert.equal(result.declineReason, 'Payment method does not match selected payment method.');
});

test('a receipt dated before the latest allowed local date is declined with both dates', () => {
  const result = validateReceiptSignals({ ...base, ocr: { ...validReceipt, date: '2026-10-03' } });
  assert.equal(result.declineReason, 'Receipt is outdated. The uploaded receipt date is 2026-10-03, but the latest allowed receipt date is 2026-10-04.');
});

test('an outdated date takes priority over amount and payment method mismatches', () => {
  const result = validateReceiptSignals({
    ...base,
    ocr: { ...validReceipt, date: '2026-09-30', amount: 1000, provider: 'gcash' },
  });
  assert.equal(result.declineReason, 'Receipt is outdated. The uploaded receipt date is 2026-09-30, but the latest allowed receipt date is 2026-10-04.');
});

test('unreadable or incomplete receipts remain pending for manual review', () => {
  for (const ocr of [
    { confidence: 20 },
    { ...validReceipt, paymentNumber: null, reference: null },
    { ...validReceipt, amount: 1000, date: null },
  ]) {
    const result = validateReceiptSignals({ ...base, ocr });
    assert.equal(result.declineReason, null);
  }
});

test('OCR values override customer supplied details when confidently extracted', () => {
  const result = validateReceiptSignals({
    ...base,
    submittedPaymentNumber: '09999999999',
    submittedReference: 'WRONG-12345',
    ocr: { ...validReceipt, paymentNumber: '09171234567', reference: 'PAY-123456' },
  });
  assert.equal(result.paymentNumber, '09171234567');
  assert.equal(result.paymentReference, 'PAY-123456');
  assert.equal(result.declineReason, 'Invalid payment/reference information.');
});
