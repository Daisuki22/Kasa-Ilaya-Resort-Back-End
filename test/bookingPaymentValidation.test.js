const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRequiredBookingPayment } = require('../src/services/bookingPaymentValidation');

const validPayment = {
  payment_number: '09171234567',
  payment_amount_due: 1500,
  payment_reference_number: 'GCASH-123456',
};

test('booking requires a valid payment number, amount, and reference number', () => {
  assert.deepEqual(validateRequiredBookingPayment(validPayment), validPayment);
});

test('booking rejects missing or invalid required payment fields', () => {
  for (const overrides of [
    { payment_number: '' },
    { payment_number: '12' },
    { payment_amount_due: 0 },
    { payment_amount_due: 'not-an-amount' },
    { payment_reference_number: '' },
    { payment_reference_number: 'x' },
  ]) {
    assert.throws(() => validateRequiredBookingPayment({ ...validPayment, ...overrides }), { status: 422 });
  }
});

test('booking trims payment number and reference number before saving', () => {
  assert.deepEqual(validateRequiredBookingPayment({
    ...validPayment,
    payment_number: ' 09171234567 ',
    payment_reference_number: ' GCASH-123456 ',
  }), validPayment);
});
