const { createWorker } = require('tesseract.js');

const MIN_CONFIDENT_MISMATCH = 75;
const MIN_CONFIDENT_VERIFICATION = 90;
let workerPromise;
let recognitionQueue = Promise.resolve();

const createEmptyReceiptOcr = () => ({
  provider: null,
  amount: null,
  reference: null,
  date: null,
  confidence: 0,
  recipient: null,
  sender: null,
  status: 'unknown',
});

const classifyPaymentProvider = (value) => {
  const text = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (/\b(gcash|g cash)\b/.test(text)) return 'gcash';
  if (/\b(maya|paymaya|pay maya)\b/.test(text)) return 'maya';
  if (/\b(paypal|pay pal)\b/.test(text)) return 'paypal';
  if (/\b(bdo|banco de oro)\b/.test(text)) return 'bdo';
  if (/\b(bpi|bank of the philippine islands)\b/.test(text)) return 'bpi';
  if (/\b(unionbank|union bank)\b/.test(text)) return 'unionbank';
  if (/\b(seabank|sea bank)\b/.test(text)) return 'seabank';
  if (/\b(gotyme|go tyme)\b/.test(text)) return 'gotyme';
  if (/\b(metrobank|metro bank)\b/.test(text)) return 'metrobank';
  return null;
};

const parseAmount = (value) => {
  const normalized = String(value || '').replace(/,/g, '').trim();
  const match = normalized.match(/\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null;
};

const extractAmount = (text) => {
  const source = String(text || '');
  const labeled = source.match(/(?:amount(?:\s+(?:sent|paid|received))?|total(?:\s+amount)?|sent|paid|received)\s*[:=\-]?\s*(?:(?:php|₱|p)\s*)?([\d,]+(?:\.\d{1,2})?)/i);
  if (labeled) return parseAmount(labeled[1]);

  const currencyPrefix = source.match(/(?:₱|\bPHP\b)\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (currencyPrefix) return parseAmount(currencyPrefix[1]);

  const currencySuffix = source.match(/([\d,]+(?:\.\d{1,2})?)\s*\bPHP\b/i);
  return currencySuffix ? parseAmount(currencySuffix[1]) : null;
};

const normalizeDate = (year, month, day) => {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!y || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

const extractDate = (text) => {
  const source = String(text || '');
  let match = source.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return normalizeDate(match[1], match[2], match[3]);

  match = source.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (match) return normalizeDate(match[3].length === 2 ? `20${match[3]}` : match[3], match[1], match[2]);

  match = source.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (!match) return null;
  const month = new Date(`${match[1]} 1, ${match[3]} UTC`).getUTCMonth() + 1;
  return normalizeDate(match[3], month, match[2]);
};

const extractReference = (text) => {
  const match = String(text || '').match(/\b(?:reference(?:\s*(?:no\.?|number|#))?|ref(?:\s*(?:no\.?|#))?|transaction(?:\s*(?:id|no\.?|number|#))?|trace(?:\s*(?:no\.?|number|#))?)\s*[:#=-]?\s*([A-Z0-9][A-Z0-9-]{4,39})/i);
  return match ? match[1].toUpperCase() : null;
};

const extractParty = (text, labelPattern) => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((candidate) => labelPattern.test(candidate));
  if (!line) return null;
  return line.replace(labelPattern, '').replace(/^\s*[:#-]?\s*/, '').trim().slice(0, 120) || null;
};

const extractReceiptFields = ({ text, confidence }) => {
  const content = String(text || '');
  const normalized = content.toLowerCase();
  const failed = /\b(failed|declined|reversed|cancelled|canceled)\b/.test(normalized);
  const success = /\b(successful|success|completed|paid|sent|received)\b/.test(normalized);

  return {
    provider: classifyPaymentProvider(content),
    amount: extractAmount(content),
    reference: extractReference(content),
    date: extractDate(content),
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(100, Number(confidence))) : 0,
    recipient: extractParty(content, /^(?:recipient|merchant|sent to|paid to)\b\s*/i),
    sender: extractParty(content, /^(?:sender|from|paid by|sent by)\b\s*/i),
    status: failed ? 'failed' : success ? 'successful' : 'unknown',
  };
};

const getWorker = async () => {
  if (!workerPromise) workerPromise = createWorker('eng');
  try {
    return await workerPromise;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
};

const recognizeReceipt = (imagePath) => {
  const task = recognitionQueue.then(async () => {
    const worker = await getWorker();
    const result = await worker.recognize(imagePath);
    return extractReceiptFields({ text: result.data.text, confidence: result.data.confidence });
  });
  recognitionQueue = task.catch(() => undefined);
  return task;
};

module.exports = {
  MIN_CONFIDENT_MISMATCH,
  MIN_CONFIDENT_VERIFICATION,
  classifyPaymentProvider,
  createEmptyReceiptOcr,
  extractAmount,
  extractDate,
  extractReceiptFields,
  recognizeReceipt,
};
