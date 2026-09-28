const fs = require('node:fs');
const path = require('node:path');

const uploadsDir = path.resolve(
  process.env.KASA_UPLOADS_DIR || path.join(process.cwd(), 'uploads')
);
const temporaryUploadsDir = path.join(uploadsDir, 'tmp');
const bundledUploadsDir = path.resolve(__dirname, '../../public/uploads');

fs.mkdirSync(temporaryUploadsDir, { recursive: true });

module.exports = { uploadsDir, temporaryUploadsDir, bundledUploadsDir };
