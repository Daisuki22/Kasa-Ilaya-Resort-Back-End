const { randomUUID } = require('node:crypto');
const express = require('express');
const { testConnection } = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    await testConnection();
    return res.json({
      success: true,
      service: 'Kasa Ilaya Resort API',
      database: 'connected',
    });
  } catch (error) {
    const requestId = randomUUID();
    console.error('Health check database connection failed', {
      requestId,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
    });
    return res.status(503).json({
      success: false,
      service: 'Kasa Ilaya Resort API',
      database: 'disconnected',
      error: 'Database unavailable.',
      request_id: requestId,
    });
  }
});

module.exports = router;
