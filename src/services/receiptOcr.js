const { createWorker } = require('tesseract.js');

const MIN_CONFIDENT_MISMATCH = 75;
const MIN_CONFIDENT_VERIFICATION = 90;
let workerPromise;
let recognitionQueue = Promise.resolve();

const createEmptyReceiptOcr = () => ({
  provider: null,
  amount: null,
  amountCurrency: null,
  phpEquivalent: null,
  paymentNumber: null,
  reference: null,
  date: null,
  confidence: 0,
  recipient: null,
  sender: null,
  status: 'unknown',
  receiptLike: false,
  sampleReceipt: false,
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
  const normalized = String(value || '').replace(/[\s,]/g, '').trim();
  const match = normalized.match(/\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const amount = Number(match[0]);
  return Number.isFinite(amount) && amount > 0 ? Number(amount.toFixed(2)) : null;
};

const extractAmountDetails = (text) => {
  const source = String(text || '');
  const lines = source.split(/\r?\n/).filter((line) => !/\b(?:exchange|conversion)\s+rate\b|\brate\s*[:=]/i.test(line));
  const phpPatterns = [/(?:₱|\bPHP\b)\s*([\d,]+(?:\.\d{1,2})?)/giu, /([\d,]+(?:\.\d{1,2})?)\s*\bPHP\b/giu];
  let phpEquivalent = null;

  // Receipts may show the charged amount in USD and its peso equivalent elsewhere.
  // Prefer the explicit PHP amount so it can be compared with the PHP booking price.
  for (const line of lines) {
    for (const pattern of phpPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      const amount = match ? parseAmount(match[1]) : null;
      if (amount !== null) {
        phpEquivalent = amount;
        break;
      }
    }
    if (phpEquivalent !== null) break;
  }

  // Maya labels an outgoing payment as "Sent money to" and displays the debit with a minus sign.
  const labeled = source.match(/(?:amount(?:\s+(?:sent|paid|received))?|total(?:\s+amount)?|sent(?:\s+money\s+to)?|paid|received)\s*[:=\-]?\s*(?:[\u2212\u2013\u2014-]\s*)?(PHP|\u20b1|\$|\u20ac|\u00a3|\u00a5)?\s*([\d][\d,\s]*(?:\.\s*\d{1,2})?)/iu);
  if (labeled) {
    const marker = labeled[1];
    const normalizedMarker = String(marker || '').normalize('NFKC').trim().toUpperCase();
    const currency = !marker ? null
      : /^(?:PHP|\u20b1|PESO(?:S)?)$/.test(normalizedMarker) ? 'PHP'
        : normalizedMarker === '$' ? 'USD'
          : marker;
    const amount = parseAmount(labeled[2]);
    return {
      amount,
      currency,
      phpEquivalent: currency === 'PHP' ? amount : phpEquivalent,
    };
  }

  // Maya OCR can split its heading and debit across text blocks or insert spaces around separators.
  const mayaSentAmount = source.match(/\bsent\s+money\s+to\b[\s\S]{0,120}?[\u2212\u2013\u2014-]?\s*((?:\d{1,3}(?:[\s,]\s*\d{3})+|\d+)\s*\.\s*\d{1,2})/iu);
  if (mayaSentAmount) {
    const amount = parseAmount(mayaSentAmount[1]);
    if (amount !== null) return { amount, currency: 'PHP', phpEquivalent: amount };
  }

  if (/\b(?:maya|paymaya)\b/i.test(source)) {
    const standaloneMoney = source.match(/(?:^|\n)\s*[\u2212\u2013\u2014-]?\s*((?:\d{1,3}(?:[\s,]\s*\d{3})+|\d+)\s*\.\s*\d{1,2})\s*(?=\r?\n|$)/iu);
    if (standaloneMoney) {
      const amount = parseAmount(standaloneMoney[1]);
      if (amount !== null) return { amount, currency: 'PHP', phpEquivalent: amount };
    }
  }


  const currencyPrefix = source.match(/(\$|€|£|¥)\s*([\d,]+(?:\.\d{1,2})?)/u);
  if (currencyPrefix) {
    const currencies = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
    return { amount: parseAmount(currencyPrefix[2]), currency: currencies[currencyPrefix[1]], phpEquivalent };
  }

  const unlabeled = source.match(/(?:^|\b)(?:amount|total)\s*[:=\-]?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (unlabeled) return { amount: parseAmount(unlabeled[1]), currency: null, phpEquivalent };
  return phpEquivalent !== null
    ? { amount: phpEquivalent, currency: 'PHP', phpEquivalent }
    : { amount: null, currency: null, phpEquivalent: null };
};

const extractAmount = (text) => extractAmountDetails(text).amount;

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

  // OCR often drops the space after the comma in dates such as "Oct 21,2026".
  match = source.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s*(20\d{2})\b/i);
  if (!match) return null;
  const month = new Date(`${match[1]} 1, ${match[3]} UTC`).getUTCMonth() + 1;
  return normalizeDate(match[3], month, match[2]);
};

const extractReference = (text) => {
  const source = String(text || '');
  const label = /\b(?:payment\s+(?:reference|ref)|transaction\s+(?:reference|ref|id|number|no\.?)|reference|ref|trace)(?:\s*(?:no\.?|number|#))?/i;
  const labelMatch = source.match(label);
  if (!labelMatch) return null;

  const start = labelMatch.index + labelMatch[0].length;
  const valueWindow = source.slice(start, start + 140)
    .replace(/^\s*[:#=-]?\s*/, '')
    .split(/\b(?:date(?:\s*(?:&|and)\s*time)?|time|amount|status|successful|completed|paid|sent\s+to|recipient|balance|service\s+fee|fee)\b\s*[:#=-]?/i, 1)[0]
    // Some GCash layouts put the date directly after "Ref No." with no label.
    .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s*20\d{2}\b[\s\S]*$/i, '');
  const candidate = valueWindow.match(/[A-Z0-9][A-Z0-9\s-]{3,60}[A-Z0-9]/i);
  if (!candidate) return null;

  // OCR can insert spaces or line breaks into long numeric IDs. Remove those
  // separators while preserving meaningful hyphens in alphanumeric IDs.
  const reference = candidate[0].toUpperCase().replace(/\s+/g, '').replace(/-+/g, '-');
  return /^[A-Z0-9][A-Z0-9-]{4,39}$/.test(reference) ? reference : null;
};

const isPhilippineMobileNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return (digits.length === 11 && digits.startsWith('09'))
    || (digits.length === 12 && digits.startsWith('639'));
};

const extractPaymentNumber = (text) => {
  const source = String(text || '');
  const maskedNumberChars = '*•●xX';
  const labeled = source.match(new RegExp(
    `\\b(?:(?:gcash|sender|payment|account|wallet|mobile|phone)\\s*(?:account\\s*)?(?:no\\.?|number|#)|(?:sent|paid)\\s+from)\\s*[:#=-]?\\s*([+()\\d][+()\\d \\t.*•●xX-]{4,31})`,
    'i'
  ));
  if (labeled) {
    const value = labeled[1].trim().replace(/\s+/g, ' ').slice(0, 64);
    const visibleDigits = value.replace(/\D/g, '').length;
    const hasMask = [...value].some((character) => maskedNumberChars.includes(character));
    if (visibleDigits >= 5 || (hasMask && visibleDigits >= 2)) {
      return value.replace(/[\u0000-\u001f\u007f]/g, '') || null;
    }
  }

  const maskedMobilePattern = /(?:\+?63|0)[\d .()\-]{0,14}[*•●xX]+[\d .()\-*•●xX]{0,12}/g;
  for (const match of source.matchAll(maskedMobilePattern)) {
    const value = match[0].trim().replace(/\s+/g, ' ').slice(0, 32);
    if (value.replace(/\D/g, '').length >= 2) return value;
  }

  // GCash receipts often print a mobile number without a "Payment Number" label.
  // Restrict this fallback to Philippine mobile number shapes to avoid grabbing
  // amounts, dates, or the transaction reference as the payer number.
  const phonePattern = /(?:\+?63|0)(?:[\s().-]*\d){9,10}/g;
  for (const match of source.matchAll(phonePattern)) {
    const value = match[0].trim().replace(/\s+/g, ' ').slice(0, 32);
    if (isPhilippineMobileNumber(value)) return value;
  }
  return null;
};

const extractParty = (text, labelPattern) => {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((candidate) => labelPattern.test(candidate));
  if (!line) return null;
  return line.replace(labelPattern, '').replace(/^\s*[:#-]?\s*/, '').trim().slice(0, 120) || null;
};

const extractRecipient = (text) => {
  const content = String(text || '');
  const labeled = extractParty(content, /^(?:recipient|merchant|sent to|paid to|pay to|payment to)\b\s*/i);
  if (labeled) return labeled;

  const authorization = content.match(/\byou will authorize\s+(.+?)\s+to charge\b/i);
  if (authorization) return authorization[1].trim().slice(0, 120) || null;

  return null;
};

const extractReceiptFields = ({ text, confidence }) => {
  const content = String(text || '');
  const normalized = content.toLowerCase();
  const failed = /\b(failed|declined|reversed|cancelled|canceled)\b/.test(normalized);
  const pending = /\b(pending|processing|will authorize|authorization pending|awaiting confirmation|payment not completed)\b/.test(normalized);
  const success = /\b(successful|success|completed|paid|sent|received)\b/.test(normalized);

  const provider = classifyPaymentProvider(content);
  let amountDetails = extractAmountDetails(content);
  // GCash and other local Philippine payment rails settle in PHP. OCR commonly
  // mistakes the peso sign for "$" or "£" on their receipts.
  const localPaymentProviders = new Set(['gcash', 'maya', 'bdo', 'bpi', 'unionbank', 'seabank', 'gotyme', 'metrobank']);
  if (localPaymentProviders.has(provider) && ['USD', 'GBP'].includes(amountDetails.currency) && amountDetails.phpEquivalent === null) {
    amountDetails = { ...amountDetails, currency: 'PHP', phpEquivalent: amountDetails.amount };
  }
  const reference = extractReference(content);
  const date = extractDate(content);
  const sampleReceipt = /\b(?:sample|demo|for\s+testing\s+only|not\s+a\s+real\s+(?:transaction|receipt))\b/i.test(content);
  const hasPaymentLanguage = /\b(payment|transaction|reference|receipt|transfer|sent|paid|received|purchase|invoice|balance|wallet|completed|successful|authorization|confirmation)\b/i.test(content);
  return {
    provider,
    amount: amountDetails.amount,
    amountCurrency: amountDetails.currency,
    phpEquivalent: amountDetails.phpEquivalent,
    paymentNumber: extractPaymentNumber(content),
    reference,
    date,
    confidence: Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(100, Number(confidence))) : 0,
    recipient: extractRecipient(content),
    sender: extractParty(content, /^(?:sender|from|paid by|sent by)\b\s*/i),
    status: failed ? 'failed' : pending ? 'pending' : success ? 'successful' : 'unknown',
    receiptLike: Boolean(provider || amountDetails.amount || reference || date || hasPaymentLanguage),
    sampleReceipt,
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
  extractAmountDetails,
  extractDate,
  extractReceiptFields,
  recognizeReceipt,
};
