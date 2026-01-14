const express = require("express");
const app = express();

const helmet = require('helmet');
const cors = require('cors');
const { generalLimiter } = require('./middleware/rateLimiters');

const appConfig = require("./config/appConfig");

// -----------------
// Global middlewares
// -----------------

// Behind proxies/load balancers (Render/Nginx/Cloudflare), this helps rate limit + IP handling.
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// -----------------
// CORS (Dev-friendly + Prod-safe)
// -----------------

// CORS allowlist (set CORS_ORIGINS as comma-separated list in .env)
const allowedOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const isDev = String(process.env.NODE_ENV || 'development') !== 'production';

const corsOptions = {
  origin: function (origin, callback) {
    // allow non-browser tools (curl/postman) and server-to-server calls
    if (!origin) return callback(null, true);

    // ✅ DEV MODE: allow localhost any port
    if (isDev) {
      if (/^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
      if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return callback(null, true);
    }

    // ✅ If env allowlist not set, allow all (dev fallback)
    if (allowedOrigins.length === 0) return callback(null, true);

    // ✅ Strict allowlist (prod or when explicitly configured)
    if (allowedOrigins.includes(origin)) return callback(null, true);

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// Global rate limit (override per-route for sensitive endpoints)
app.use(generalLimiter);

// Capture raw body so payout providers can verify webhook signatures reliably.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Cookies (needed for JWT cookie auth)
const cookieParser = require('cookie-parser');
app.use(cookieParser());

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