// BPA API Express app (TypeScript source, CommonJS runtime style)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { env } = require("./config/env");
const apiV1Routes = require("./api/v1/routes");

const { notFoundHandler, errorHandler } = require("./api/v1/middlewares/errors");

const app = express();

// Security & basics
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/health", (_req, res) => res.json({ ok: true, service: "bpa_api" }));

// API mount
app.use(env.apiPrefix || "/api/v1", apiV1Routes);

// Errors
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

export {};
