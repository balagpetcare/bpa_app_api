// BPA API Express app (TypeScript source, CommonJS runtime style)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const { env } = require("./config/env");

// ✅ Prisma singleton before any route module (routes pull in controllers that need DB)
const { prisma } = require("./config/prisma");

const apiV1Routes = require("./api/v1/routes");

const { notFoundHandler, errorHandler } = require("./api/v1/middlewares/errors");

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

/**
 * Socket.IO upgrade path: do not let Express handle or respond so the HTTP server
 * upgrade listener (Socket.IO in index.ts) can take the connection.
 */
app.use((req, res, next) => {
  const url = (req.originalUrl || req.url || "").split("?")[0];
  if (url.startsWith("/api/v1/socket.io")) {
    return; // do not call next(), do not send; leave connection for Socket.IO upgrade
  }
  next();
});

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

// API mount — MUST be /api/v1 so admin governance routes match: GET /api/v1/admin/producers, GET /api/v1/admin/approvals
const apiPrefix = env.apiPrefix ?? process.env.API_PREFIX ?? "/api/v1";
// Explicit admin governance mounts (before generic v1 so these paths always match)
try {
  const adminProducersRoutes = require("./api/v1/modules/admin_producers/admin_producers.routes");
  const adminApprovalsRoutes = require("./api/v1/modules/admin_approvals/admin_approvals.routes");
  app.use("/api/v1/admin/producers", adminProducersRoutes);
  app.use("/api/v1/admin/approvals", adminApprovalsRoutes);
} catch (err) {
  console.error("[app] Admin governance routes failed to load. Restart after ensuring dependencies exist.", err);
  app.use("/api/v1/admin/producers", (req, res) =>
    res.status(503).json({ success: false, message: "Governance routes not loaded; check server logs and restart API." }));
  app.use("/api/v1/admin/approvals", (req, res) =>
    res.status(503).json({ success: false, message: "Governance routes not loaded; check server logs and restart API." }));
}

// Admin medicine catalog import (CSV staging / apply) — hard-mount before v1 router so
// POST /api/v1/admin/medicine-catalog-import/upload and GET .../batches work when dist/api/v1/routes.js
// is stale under npm start (same rationale as producers/approvals and clinic matrix mounts).
try {
  const adminMedicineCatalogImportRoutes = require("./api/v1/modules/admin_medicine_import/admin_medicine_import.routes");
  app.use(`${apiPrefix}/admin/medicine-catalog-import`, adminMedicineCatalogImportRoutes);
} catch (err) {
  console.error(
    "[app] Admin medicine-catalog-import routes failed to load. Run `npm run build` in backend-api and restart.",
    err
  );
  app.use(`${apiPrefix}/admin/medicine-catalog-import`, (_req, res) =>
    res.status(503).json({
      success: false,
      message: "Medicine catalog import routes not loaded; run npm run build and restart API.",
    }));
}

/**
 * Services & Pricing (staff): hard-mount on the Express app BEFORE the v1 router.
 * Ensures matrix / pricing / media / fee-history always match even when dist/api/v1/routes.js
 * or dist/.../clinic.routes.js is stale or partially deployed (npm start).
 * Handlers are identical to clinic.routes.ts; v1 duplicates are harmless (this layer matches first).
 */
try {
  const clinicCtrlHard = require("./api/v1/modules/clinic/clinic.controller");
  const authenticateTokenHard = require("./middleware/auth.middleware");
  const countryScopeGuardHard = require("./middlewares/countryScopeGuard");
  const { requireClinicPermission: requireClinicPermHard } = require("./api/v1/modules/clinic/clinic.middleware");
  const clinicBranch = `${apiPrefix}/clinic/branches`;
  app.get(
    `${clinicBranch}/:branchId/service-pricing/matrix`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard(
      "manager.pricing.view",
      "clinic.services.manage",
      "clinic.appointments.read",
      "clinic.appointments.manage"
    ),
    clinicCtrlHard.getServicePricingMatrix
  );
  app.get(
    `${clinicBranch}/:branchId/services/:serviceId/pricing-history`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard("clinic.services.manage", "manager.pricing.view", "clinic.appointments.manage"),
    clinicCtrlHard.getServicePricingHistory
  );
  app.patch(
    `${clinicBranch}/:branchId/services/:serviceId/pricing`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard("clinic.services.manage", "clinic.appointments.manage"),
    clinicCtrlHard.patchClinicServicePricing
  );
  app.get(
    `${clinicBranch}/:branchId/services/:serviceId/media`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard("clinic.services.manage", "clinic.appointments.manage", "manager.pricing.view"),
    clinicCtrlHard.getClinicServiceMedia
  );
  app.put(
    `${clinicBranch}/:branchId/services/:serviceId/media`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard("clinic.services.manage", "clinic.appointments.manage"),
    clinicCtrlHard.putClinicServiceMedia
  );
  app.get(
    `${clinicBranch}/:branchId/doctors/:memberId/fee-history`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard("clinic.doctors.view", "clinic.services.manage", "manager.pricing.view"),
    clinicCtrlHard.getDoctorFeeHistory
  );
  // Doctor approvals queue KPIs — hard-mount before v1 router (same rationale as matrix/fee-history).
  // Ensures GET /api/v1/clinic/branches/:branchId/approval-requests/summary works when dist/clinic.routes.js
  // or dist/api/v1/routes.js is stale under npm start.
  app.get(
    `${clinicBranch}/:branchId/approval-requests/summary`,
    countryScopeGuardHard,
    authenticateTokenHard,
    requireClinicPermHard("approvals.view", "clinic.packages.read"),
    clinicCtrlHard.getClinicApprovalRequestsSummary
  );
} catch (e) {
  console.error("[app] Clinic Services & Pricing hard-mounts failed (fall back to v1 router only)", e);
}

app.use(apiPrefix, apiV1Routes);

// Errors
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;

export {};
