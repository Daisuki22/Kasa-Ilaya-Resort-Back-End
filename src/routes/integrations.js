const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes, createHash } = require('node:crypto');
const { sendMail } = require('../services/mail');
const { pool } = require('../config/database');
const { uploadsDir, temporaryUploadsDir } = require('../config/uploads');
const { auth } = require('../middleware/auth');
const { isAdmin } = require('../utils');
const config = require('../config/env');
const { createPaymentProofUploadToken } = require('../services/paymentProofUpload');
const { createEmptyReceiptOcr, recognizeReceipt, MIN_CONFIDENT_VERIFICATION } = require('../services/receiptOcr');
const { MAX_PAYMENT_RECEIPT_BYTES, isValidPaymentReceiptImage } = require('../services/paymentReceiptFile');
const { validateReceiptSignals } = require('../services/receiptValidation');
const { getTodayManilaDate } = require('../services/bookingSchedule');

const router = express.Router();
const upload = multer({ dest: temporaryUploadsDir, limits: { fileSize: MAX_PAYMENT_RECEIPT_BYTES } });
const parseSingleUpload = (req, res, next) => upload.single('file')(req, res, (error) => {
  if (!error) return next();
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large. Upload an image no larger than 8 MB.' });
  }
  if (error instanceof multer.MulterError) {
    return res.status(422).json({ error: 'Upload failed. Please select one supported image and try again.' });
  }
  return next(error);
});
const imageExtensions = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const removeTemporaryFile = (file) => {
  if (file?.path) {
    try {
      fs.unlinkSync(file.path);
    } catch {}
  }
};

const requireUserForSensitiveActions = (req, res, next) => {
  const action = String(req.query.action || '');
  if (['upload-file', 'send-email'].includes(action) && !req.user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  return next();
};

router.post('/', auth, requireUserForSensitiveActions, parseSingleUpload, async (req, res, next) => {
  try {
    const action = String(req.query.action || '');

    if (action === 'upload-file') {
      if (!req.user) {
        removeTemporaryFile(req.file);
        return res.status(401).json({ error: 'Not authenticated.' });
      }
      if (!req.file) return res.status(422).json({ error: 'No file uploaded.' });

      const purpose = String(req.body.purpose || '');
      if (!['payment_receipt', 'profile_image'].includes(purpose) && !isAdmin(req.user)) {
        removeTemporaryFile(req.file);
        return res.status(403).json({ error: 'Only resort administrators can upload resort images.' });
      }

      const extension = imageExtensions[req.file.mimetype];
      if (!extension || !isValidPaymentReceiptImage(req.file.mimetype, fs.readFileSync(req.file.path))) {
        removeTemporaryFile(req.file);
        return res.status(422).json({ error: 'The upload is not a valid JPG, PNG, or WebP image. Please choose a supported image file.' });
      }

      const month = new Date().toISOString().slice(0, 7).replace('-', '/');
      const directory = path.join(uploadsDir, month);
      const name = `${purpose === 'profile_image' ? 'profile' : 'upload'}_${randomBytes(16).toString('hex')}${extension}`;
      const target = path.join(directory, name);
      fs.mkdirSync(directory, { recursive: true });
      fs.renameSync(req.file.path, target);
      const fileUrl = `/uploads/${month}/${name}`;
      if (purpose === 'payment_receipt') {
        let ocr = createEmptyReceiptOcr();
        try {
          ocr = await recognizeReceipt(target);
        } catch (error) {
          console.warn('Payment receipt OCR unavailable; keeping proof in manual review', {
            requestId: req.requestId,
            code: error.code,
            name: error.name,
          });
        }
        const fingerprint = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
        const [duplicateFiles] = await pool.query(
          'SELECT id FROM bookings WHERE payment_proof_fingerprint=? LIMIT 1',
          [fingerprint]
        );
        const ocrSummary = {
          provider: ocr.provider,
          amount: ocr.amount,
          payment_number: ocr.paymentNumber,
          autofill_payment_number: Number(ocr.confidence) >= MIN_CONFIDENT_VERIFICATION && Boolean(ocr.paymentNumber),
          reference: ocr.reference,
          autofill_reference: Number(ocr.confidence) >= MIN_CONFIDENT_VERIFICATION && Boolean(ocr.reference),
          date: ocr.date,
          confidence: ocr.confidence,
          status: ocr.status,
          duplicate_image: duplicateFiles.length > 0,
        };
        let validation = 'pending_review';
        let message = 'Receipt content was scanned for review signals. An authorized admin still needs to verify the original proof.';
        const selectedQrCodeId = String(req.body.payment_qr_code_id || '').trim();
        if (selectedQrCodeId) {
          const [methods] = await pool.query(
            'SELECT label,account_number FROM payment_qr_codes WHERE id=? AND is_active=1 LIMIT 1',
            [selectedQrCodeId]
          );
          if (!methods[0]) {
            try { fs.unlinkSync(target); } catch {}
            return res.status(422).json({ error: 'The selected payment method is unavailable. Refresh the page and upload the receipt again.' });
          }
          const signals = validateReceiptSignals({
            ocr,
            requiredAmount: Number(req.body.payment_amount_due),
            selectedMethod: methods[0].label,
            expectedAccountNumber: methods[0].account_number,
            submittedPaymentNumber: req.body.payment_number,
            submittedReference: req.body.payment_reference_number,
            latestAllowedDate: getTodayManilaDate(),
          });
          if (signals.declineReason) {
            validation = 'declined';
            message = signals.declineReason;
          }
        }
        return res.json({
          file_url: fileUrl,
          purpose,
          proof_upload_token: createPaymentProofUploadToken({
            userId: req.user.id,
            fileUrl,
            secret: config.jwtSecret,
            ocr: ocrSummary,
          }),
          validation,
          ocr_summary: ocrSummary,
          message,
        });
      }
      return res.json({
        file_url: fileUrl,
        purpose,
      });
    }

    if (action === 'send-email') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated.' });
      const recipient = String(req.body?.to || '').trim().toLowerCase();
      if (!isAdmin(req.user) && recipient !== String(req.user.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'You can only send booking email to your own address.' });
      }
      const result = await sendMail(
        recipient,
        String(req.body?.subject || ''),
        String(req.body?.body || ''),
        String(req.body?.purpose || 'main')
      );
      return res.status(result.sent ? 200 : 202).json(result);
    }

    if (action === 'invoke-llm') {
      const prompt = String(req.body?.prompt || '').toLowerCase();
      const [packages] = await pool.query(
        'SELECT name,price,max_guests FROM packages WHERE is_active=1 ORDER BY created_date DESC'
      );
      if (prompt.includes('package') || prompt.includes('price')) {
        return res.json({
          response: 'Here are the current packages:\n' + packages
            .map((item) => `- ${item.name}: PHP ${Number(item.price).toLocaleString()} base price for one included guest; additional guests are allowed for an extra fee`)
            .join('\n'),
        });
      }
      if (prompt.includes('book')) {
        return res.json({ response: 'Open the Packages page, choose a package, and submit the reservation form.' });
      }
      if (prompt.includes('lost') || prompt.includes('found')) {
        return res.json({ response: 'The Lost and Found pages are connected to the resort database.' });
      }
      return res.json({ response: 'I can help with packages, bookings, amenities, and lost-and-found questions for Kasa Ilaya Resort.' });
    }

    return res.status(405).json({ error: 'Unsupported integration action.' });
  } catch (error) {
    removeTemporaryFile(req.file);
    return next(error);
  }
});

module.exports = router;
