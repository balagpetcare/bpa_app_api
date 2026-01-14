const rateLimit = require('express-rate-limit');

// Helper to read numeric envs safely
function numEnv(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Global baseline limiter (most endpoints)
const generalLimiter = rateLimit({
  windowMs: numEnv('RL_GENERAL_WINDOW_MS', 15 * 60 * 1000),
  limit: numEnv('RL_GENERAL_MAX', 300),
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth endpoints
const authLimiter = rateLimit({
  windowMs: numEnv('RL_AUTH_WINDOW_MS', 15 * 60 * 1000),
  limit: numEnv('RL_AUTH_MAX', 20),
  standardHeaders: true,
  legacyHeaders: false,
});

// Withdraw endpoints (create/cancel)
const withdrawLimiter = rateLimit({
  windowMs: numEnv('RL_WITHDRAW_WINDOW_MS', 60 * 1000),
  limit: numEnv('RL_WITHDRAW_MAX', 10),
  standardHeaders: true,
  legacyHeaders: false,
});

// Webhooks (should be higher; providers may retry)
const webhookLimiter = rateLimit({
  windowMs: numEnv('RL_WEBHOOK_WINDOW_MS', 60 * 1000),
  limit: numEnv('RL_WEBHOOK_MAX', 120),
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  authLimiter,
  withdrawLimiter,
  webhookLimiter,
};
