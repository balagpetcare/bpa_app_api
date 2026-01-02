const express = require("express");
const app = express();

const appConfig = require("./config/appConfig");

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ API PREFIX (single source of truth)
const PREFIX = appConfig.api?.prefix || "/api/v1";

// ✅ single main router (Docker/Linux friendly)
const apiRoutes = require("./api/v1/routes");
app.use(PREFIX, apiRoutes);

// not found handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

module.exports = app;
