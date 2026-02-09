// Single stable entrypoint for BPA API
// - Loads env via ./config/env
// - Uses the hardened Express app (src/app.ts)
// NOTE: Prisma middleware must be attached inside src/app.ts (before routes)

const http = require("http");
const { env } = require("./config/env");
const app = require("./app");

const port = Number(env.port || process.env.PORT || 3000);
const apiPrefix = env.apiPrefix || process.env.API_PREFIX || "/api/v1";

// Background maintenance jobs (lightweight in-process schedulers)
try {
  const { startStaffInviteCleanup } = require("./common/jobs/staffInviteCleanup");
  startStaffInviteCleanup();
} catch (e) {
  console.error("[JOB_INIT] staffInviteCleanup failed", e);
}
try {
  const { runExpiryEngineJob } = require("./common/jobs/expiryEngine.job");
  const expiryIntervalMs = Number(process.env.EXPIRY_ENGINE_INTERVAL_MS || 24 * 60 * 60 * 1000);
  function runExpiry() {
    runExpiryEngineJob().catch((err) => console.error("[JOB_INIT] expiryEngine error", err));
  }
  runExpiry();
  setInterval(runExpiry, expiryIntervalMs).unref?.();
} catch (e) {
  console.error("[JOB_INIT] expiryEngine failed", e);
}
try {
  const { startOwnersTeamAutomation } = require("./common/jobs/ownersTeamAutomation.job");
  startOwnersTeamAutomation();
} catch (e) {
  console.error("[JOB_INIT] ownersTeamAutomation failed", e);
}

/**
 * ✅ Request logger (must be registered BEFORE app.listen)
 * Helps debug 500s like PUT /owner/kyc
 */
app.use((req: any, _res: any, next: any) => {
  try {
    console.log(`[REQ] ${req.method} ${req.originalUrl}`);

    // Log JSON body safely (avoid logging huge uploads)
    const contentType = String(req.headers["content-type"] || "");
    if (contentType.includes("application/json")) {
      // body might be undefined if body-parser isn't enabled in app.ts
      if (req.body !== undefined) {
        console.log("[BODY]", JSON.stringify(req.body));
      } else {
        console.log("[BODY] <undefined> (check json body parser in app.ts)");
      }
    }
  } catch (e) {
    console.error("[REQ_LOGGER_ERROR]", e);
  }
  next();
});

/**
 * ✅ Process-level error visibility (helps when errors don't print)
 */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

/**
 * ✅ Start server (HTTP server so we can attach WebSocket at /api/v1/realtime)
 */
const server = http.createServer(app);
server.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://0.0.0.0:${port}${apiPrefix}`);
});

try {
  const { attachRealtimeGateway } = require("./realtime/realtime.gateway");
  attachRealtimeGateway(server);
} catch (e) {
  console.warn("[Realtime] Gateway attach failed", e?.message || e);
}

export {};
