const MAX_PAYMENT_RECEIPT_BYTES = 8 * 1024 * 1024;
const SUPPORTED_PAYMENT_RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function isValidPaymentReceiptImage(mimeType, file) {
  const bytes = Buffer.isBuffer(file) ? file : Buffer.alloc(0);
  if (!SUPPORTED_PAYMENT_RECEIPT_TYPES.has(mimeType) || bytes.length > MAX_PAYMENT_RECEIPT_BYTES) return false;
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR'
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  if (mimeType === 'image/webp') return bytes.length >= 16
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

module.exports = { MAX_PAYMENT_RECEIPT_BYTES, isValidPaymentReceiptImage };
