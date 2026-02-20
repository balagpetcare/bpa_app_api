// BPA API Express app (TypeScript source, CommonJS runtime style)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { env } = require("./config/env");
const apiV1Routes = require("./api/v1/routes");

const { notFoundHandler, errorHandler } = require("./api/v1/middlewares/errors");

// ✅ Prisma singleton (shared)
const { prisma } = require("./config/prisma");

const app = express();

// Security & basics
// Configure helmet to allow inline scripts for auth UI pages
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
        fontSrc: ["'self'", "cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "https:", "wowdash.flavor33labs.com"],
        connectSrc: ["'self'", "http://localhost:*"],
      },
    },
  })
);

/**
 * ✅ CORS: use allowlist (recommended)
 * env.CORS_ORIGINS example:
 * "http://localhost:3100,http://localhost:3101,...,http://localhost:3106"
 * credentials: true is required for cookie auth (panels on different ports).
 */
const allowedOrigins = String(env.corsOrigins || process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser clients (no origin) like curl/postman
      if (!origin) return callback(null, true);

      // if allowlist empty, fallback to true (dev-friendly)
      if (allowedOrigins.length === 0) return callback(null, true);

      return allowedOrigins.includes(origin)
        ? callback(null, true)
        : callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true, // required for access_token cookie across panel ports
  })
);

app.use(cookieParser());

// Body parsing
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

/**
 * ✅ Prisma attach middleware
 * MUST be registered BEFORE routes
 */
app.use((req, _res, next) => {
  req.prisma = prisma;
  next();
});

/**
 * ✅ Global-Ready Phase 1: Country context (header → user → org → default BD)
 * Sets req.countryContext = { countryCode, policy }; no header = default BD.
 */
const countryContextMiddleware = require("./middlewares/countryContext");
const optionalAuth = require("./middlewares/optionalAuth");

// Global optional auth to populate req.user for country context resolution
app.use(optionalAuth);
app.use(countryContextMiddleware);

// Health
app.get("/health", (_req, res) => res.json({ ok: true, service: "bpa_api" }));

// ✅ Central Auth UI Routes (HTML pages for login/register)
// Serves at /auth/login and /auth/register
const authUiRoutes = require("./api/v1/modules/auth-ui/auth-ui.routes");
app.use("/auth", authUiRoutes);

// API mount
app.use(env.apiPrefix || "/api/v1", apiV1Routes);

// Errors
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

export {};
