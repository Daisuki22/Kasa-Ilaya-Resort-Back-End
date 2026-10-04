const { MIN_CONFIDENT_MISMATCH, classifyPaymentProvider } = require('./receiptOcr');

const cleanReceiptValue = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  return cleaned || null;
};

function validateReceiptSignals({ ocr = {}, requiredAmount, selectedMethod, expectedAccountNumber, submittedPaymentNumber, submittedReference, createdDate }) {
  const confidence = Number(ocr.confidence) || 0;
  const confident = confidence >= MIN_CONFIDENT_MISMATCH;
  const detectedProvider = classifyPaymentProvider(ocr.provider);
  const selectedProvider = classifyPaymentProvider(selectedMethod);
  const extractedPaymentNumber = cleanReceiptValue(ocr.paymentNumber, 64);
  const extractedReference = cleanReceiptValue(ocr.reference, 128);
  const expectedAccountDigits = String(expectedAccountNumber || '').replace(/\D/g, '');
  const recipientDigits = String(ocr.recipient || '').replace(/\D/g, '');
  const paymentNumber = confident && extractedPaymentNumber ? extractedPaymentNumber : cleanReceiptValue(submittedPaymentNumber, 64);
  const paymentReference = confident && extractedReference ? extractedReference : cleanReceiptValue(submittedReference, 128);
  let declineReason = null;

  if (confident && Number.isFinite(Number(ocr.amount)) && Number(ocr.amount) > 0
      && Math.abs(Number(ocr.amount) - Number(requiredAmount)) > 0.01) {
    declineReason = 'Payment amount does not match required amount.';
  } else if (confident && detectedProvider && selectedProvider && detectedProvider !== selectedProvider) {
    declineReason = 'Payment method does not match selected payment method.';
  } else if (confident && expectedAccountDigits.length >= 5 && recipientDigits.length === expectedAccountDigits.length
      && recipientDigits !== expectedAccountDigits) {
    declineReason = 'Payment method does not match selected payment method.';
  } else if (confident && ocr.date && createdDate && ocr.date < createdDate) {
    declineReason = 'Receipt date is outside the allowed payment date.';
  } else if (confident && extractedPaymentNumber && submittedPaymentNumber
      && extractedPaymentNumber.replace(/\D/g, '') !== String(submittedPaymentNumber).replace(/\D/g, '')) {
    declineReason = 'Invalid payment/reference information.';
  } else if (confident && extractedReference && submittedReference
      && extractedReference.toLowerCase() !== String(submittedReference).trim().toLowerCase()) {
    declineReason = 'Invalid payment/reference information.';
  } else if (confident && ocr.status === 'failed') {
    declineReason = 'Unable to verify receipt information.';
  }

  return {
    detectedProvider,
    paymentNumber,
    paymentReference,
    extractedPaymentNumber,
    extractedReference,
    declineReason,
    amount: Number.isFinite(Number(ocr.amount)) && Number(ocr.amount) > 0 ? Number(Number(ocr.amount).toFixed(2)) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(ocr.date || '')) ? ocr.date : null,
    confidence: Math.max(0, Math.min(100, confidence)),
  };
}

module.exports = { cleanReceiptValue, validateReceiptSignals };
