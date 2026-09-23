const express = require("express");
const { testConnection } = require("../config/database");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await testConnection();
    res.json({
      success: true,
      service: "Kasa Ilaya Resort API",
      database: "connected",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Health database check failed:", error.message);
    res.status(503).json({
      success: false,
      service: "Kasa Ilaya Resort API",
      database: "disconnected"
    });
  }
});

module.exports = router;
