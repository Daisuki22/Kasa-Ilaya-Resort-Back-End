const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { sendMail } = require('../services/mail');
const { pool } = require('../config/database');
const { uploadsDir, temporaryUploadsDir } = require('../config/uploads');
const { auth } = require('../middleware/auth');
const { isAdmin } = require('../utils');

const router = express.Router();
const upload = multer({ dest: temporaryUploadsDir, limits: { fileSize: 8 * 1024 * 1024 } });
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

router.post('/', auth, requireUserForSensitiveActions, upload.single('file'), async (req, res, next) => {
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
      if (!extension) {
        removeTemporaryFile(req.file);
        return res.status(422).json({ error: 'Only JPG, PNG, or WebP images are allowed.' });
      }

      const month = new Date().toISOString().slice(0, 7).replace('-', '/');
      const directory = path.join(uploadsDir, month);
      const name = `upload_${Date.now()}_${Math.random().toString(16).slice(2)}${extension}`;
      const target = path.join(directory, name);
      fs.mkdirSync(directory, { recursive: true });
      fs.renameSync(req.file.path, target);
      return res.json({ file_url: `/uploads/${month}/${name}`, purpose });
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
            .map((item) => `- ${item.name}: PHP ${Number(item.price).toLocaleString()} for up to ${item.max_guests} guests`)
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
