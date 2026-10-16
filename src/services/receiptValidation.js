const { MIN_CONFIDENT_MISMATCH, classifyPaymentProvider } = require('./receiptOcr');

const cleanReceiptValue = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
  return cleaned || null;
};

const isReceiptDateToday = (receiptDate, todayManila) => /^\d{4}-\d{2}-\d{2}$/.test(String(receiptDate || ''))
  && /^\d{4}-\d{2}-\d{2}$/.test(String(todayManila || ''))
  && receiptDate === todayManila;

function normalizeRecipientName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function recipientMatchesExpected(recipient, expectedName) {
  const actualTokens = normalizeRecipientName(recipient);
  const expectedTokens = normalizeRecipientName(expectedName);
  if (!actualTokens.length || !expectedTokens.length) return true;
  const matches = expectedTokens.filter((token) => actualTokens.includes(token)).length;
  const requiredMatches = expectedTokens.length <= 2 ? expectedTokens.length : Math.max(2, Math.ceil(expectedTokens.length * 0.6));
  return matches >= requiredMatches;
}

function validateReceiptSignals({ ocr = {}, requiredAmount, selectedMethod, expectedAccountName, expectedAccountNumber, submittedPaymentNumber, submittedReference, latestAllowedDate }) {
  const confidence = Number(ocr.confidence) || 0;
  const confident = confidence >= MIN_CONFIDENT_MISMATCH;
  const detectedProvider = classifyPaymentProvider(ocr.provider);
  const selectedProvider = classifyPaymentProvider(selectedMethod);
  const extractedPaymentNumber = cleanReceiptValue(ocr.paymentNumber, 64);
  const extractedReference = cleanReceiptValue(ocr.reference, 128);
  const amountCurrency = String(ocr.amountCurrency || ocr.amount_currency || '').toUpperCase();
  const phpEquivalent = Number(ocr.phpEquivalent ?? ocr.php_equivalent);
  const extractedAmount = Number(ocr.amount);
  const hasExtractedAmount = Number.isFinite(extractedAmount) && extractedAmount > 0;
  const hasPhpEquivalent = Number.isFinite(phpEquivalent) && phpEquivalent > 0;
  const comparableAmount = amountCurrency === 'USD'
    ? (hasPhpEquivalent ? phpEquivalent : null)
    : amountCurrency && amountCurrency !== 'PHP'
      ? (hasPhpEquivalent ? phpEquivalent : null)
      : hasExtractedAmount ? extractedAmount : hasPhpEquivalent ? phpEquivalent : null;
  const expectedAccountDigits = String(expectedAccountNumber || '').replace(/\D/g, '');
  const recipientDigits = String(ocr.recipient || '').replace(/\D/g, '');
  const paymentNumber = confident && extractedPaymentNumber ? extractedPaymentNumber : cleanReceiptValue(submittedPaymentNumber, 64);
  const paymentReference = confident && extractedReference ? extractedReference : cleanReceiptValue(submittedReference, 128);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(ocr.date || '')) ? ocr.date : null;
  const receiptLike = ocr.receiptLike ?? ocr.receipt_like;
  const recognitionFailed = Boolean(ocr.recognitionFailed ?? ocr.recognition_failed);
  const sampleReceipt = Boolean(ocr.sampleReceipt ?? ocr.sample_receipt);
  const notReceipt = receiptLike === false && !recognitionFailed;
  let declineReason = null;

  if (validDate && latestAllowedDate && !isReceiptDateToday(validDate, latestAllowedDate)) {
    declineReason = validDate < latestAllowedDate
      ? `Receipt is outdated. Only receipts dated today are accepted. Receipt date: ${validDate}. Required date: ${latestAllowedDate}.`
      : `Receipt date is invalid. Only receipts dated today are accepted. Receipt date: ${validDate}. Required date: ${latestAllowedDate}.`;
  } else if (sampleReceipt) {
    declineReason = 'Sample or test receipts are not accepted. Upload the original payment receipt.';
  } else if (latestAllowedDate && !validDate) {
    declineReason = 'The receipt transaction date could not be verified. Upload a clear receipt showing the payment date.';
  } else if (hasExtractedAmount || hasPhpEquivalent) {
    const expectedAmount = Number(requiredAmount);
    if (!Number.isFinite(expectedAmount) || expectedAmount <= 0 || comparableAmount === null) {
      declineReason = 'Payment amount could not be verified against the required amount.';
    } else if (Math.round(comparableAmount * 100) !== Math.round(expectedAmount * 100)) {
      declineReason = 'Payment amount does not match required amount.';
    }
  } else if (detectedProvider && selectedProvider && detectedProvider !== selectedProvider) {
    declineReason = 'Payment method does not match selected payment method.';
  } else if (confident && expectedAccountDigits.length >= 5 && recipientDigits.length === expectedAccountDigits.length
      && recipientDigits !== expectedAccountDigits) {
    declineReason = 'Payment method does not match selected payment method.';
  } else if (confident && ocr.recipient && expectedAccountName && !recipientMatchesExpected(ocr.recipient, expectedAccountName)) {
    declineReason = 'The receipt recipient does not match the selected resort payment account.';
  } else if (confident && extractedPaymentNumber && submittedPaymentNumber
      && extractedPaymentNumber.replace(/\D/g, '') !== String(submittedPaymentNumber).replace(/\D/g, '')) {
    declineReason = 'Invalid payment/reference information.';
  } else if (confident && extractedReference && submittedReference
      && extractedReference.toLowerCase() !== String(submittedReference).trim().toLowerCase()) {
    declineReason = 'Invalid payment/reference information.';
  } else if (confident && ocr.status === 'failed') {
    declineReason = 'Unable to verify receipt information.';
  } else if (confident && ocr.status === 'pending') {
    declineReason = 'This shows a pending authorization, not a completed payment receipt.';
  } else if (notReceipt) {
    declineReason = 'This image does not appear to show a payment receipt. Upload a screenshot with visible payment details.';
  }

  return {
    detectedProvider,
    paymentNumber,
    paymentReference,
    extractedPaymentNumber,
    extractedReference,
    declineReason,
    notReceipt,
    amount: comparableAmount !== null ? Number(comparableAmount.toFixed(2)) : null,
    amountCurrency: amountCurrency || null,
    date: validDate,
    confidence: Math.max(0, Math.min(100, confidence)),
  };
}

module.exports = { cleanReceiptValue, isReceiptDateToday, validateReceiptSignals };
