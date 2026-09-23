const express = require("express");
const { testConnection } = require("../config/database");

const router = express.Router();

router.get("/", async (req, res) => {
  const databaseConnected = await testConnection();

  if (!databaseConnected) {
    return res.status(503).json({
      success: false,
      service: "Kasa Ilaya Resort API",
      database: "disconnected"
    });
  }

  return res.json({
    success: true,
    service: "Kasa Ilaya Resort API",
    database: "connected",
    environment: process.env.NODE_ENV || "development"
  });
});

module.exports = router;