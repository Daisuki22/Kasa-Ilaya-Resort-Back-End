const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const config = require("./config/env");
const healthRouter = require("./routes/health");
const authRouter = require("./routes/auth");
const resourcesRouter = require("./routes/resources");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();

app.disable("x-powered-by");

app.use(helmet());
app.use(cors({
  origin: config.frontendUrl,
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(morgan(config.nodeEnv === "production" ? "combined" : "dev"));

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "Kasa Ilaya Resort API",
    version: "1.0.0"
  });
});

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api", resourcesRouter);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Kasa Ilaya Resort API listening on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
