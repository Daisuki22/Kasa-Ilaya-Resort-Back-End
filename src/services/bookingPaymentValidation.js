function httpError(message, status = 422) {
  return Object.assign(new Error(message), { status });
}

function validateRequiredBookingPayment(record, { allowMissingDetails = false } = {}) {
  const paymentNumber = String(record.payment_number || '').trim();
  const paymentReferenceNumber = String(record.payment_reference_number || '').trim();
  const paymentAmount = Number(record.payment_amount_due);

  if ((!allowMissingDetails || paymentNumber) && (paymentNumber.length < 5 || paymentNumber.length > 64 || /[\u0000-\u001f\u007f]/.test(paymentNumber))) {
    throw httpError('Enter a valid payment number (5 to 64 characters).');
  }
  if ((!allowMissingDetails || paymentReferenceNumber) && (paymentReferenceNumber.length < 4 || paymentReferenceNumber.length > 128 || /[\u0000-\u001f\u007f]/.test(paymentReferenceNumber))) {
    throw httpError('Enter a valid payment reference number (4 to 128 characters).');
  }
  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw httpError('A valid payment amount is required before submitting your booking.');
  }

  return {
    payment_number: paymentNumber || null,
    payment_amount_due: paymentAmount,
    payment_reference_number: paymentReferenceNumber || null,
  };
}

module.exports = { validateRequiredBookingPayment };
