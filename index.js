/**
 * index.js (FULL)
 * - Mounts all routers using appConfig.api.prefix (single source of truth)
 * - Prints all registered endpoints (DEV recommended, but you can enable always)
 * - Includes router-level listing to catch “empty router” issues
 */

require("dotenv").config();

const express = require("express");
const listEndpoints = require("express-list-endpoints");

const app = express();
const appConfig = require("./src/config/appConfig");

app.use(express.json());

// Routes (Routers)
const authRoutes = require("./src/routes/user/authRoutes");
const petRoutes = require("./src/routes/user/petRoutes");
const commonRoutes = require("./src/routes/common/common.routes");
const profileRoutes = require("./src/routes/user/profile.routes");

// ⭐ SINGLE SOURCE OF TRUTH (Prefix)
const PREFIX = appConfig.api.prefix; // e.g. "/api/v1"

// ✅ Mount Routers
app.use(`${PREFIX}/auth`, authRoutes);
app.use(`${PREFIX}/pets`, petRoutes);
app.use(`${PREFIX}/common`, commonRoutes);
app.use(`${PREFIX}/profile`, profileRoutes);

// Health check (root)
app.get("/", (req, res) => {
  res.send(`BPA API Running (${PREFIX})`);
});

// ✅ ROUTE LISTING
// Tip: You can keep it always ON in dev. For prod, wrap with NODE_ENV check.
function printRoutes() {
  console.log("\n==============================");
  console.log("API PREFIX =", PREFIX);
  console.log("NODE_ENV   =", process.env.NODE_ENV || "undefined");
  console.log("==============================\n");

  // Debug: ensure routers are real Express Routers and have stack
  const debugRouter = (name, r) => {
    const hasStack = !!r?.stack;
    const len = r?.stack?.length ?? 0;
    console.log(`${name}: has stack = ${hasStack}, stack len = ${len}`);
  };

  debugRouter("authRoutes", authRoutes);
  debugRouter("petRoutes", petRoutes);
  debugRouter("commonRoutes", commonRoutes);
  debugRouter("profileRoutes", profileRoutes);

  console.log("\n----- Router-level endpoints (without prefix) -----");
  try {
    console.log("AUTH   :", listEndpoints(authRoutes));
    console.log("PETS   :", listEndpoints(petRoutes));
    console.log("COMMON :", listEndpoints(commonRoutes));
    console.log("PROFILE:", listEndpoints(profileRoutes));
  } catch (e) {
    console.log("Router-level list error:", e.message);
  }

  console.log("\n----- App-level endpoints (may or may not include mount prefixes) -----");
  try {
    console.log(listEndpoints(app));
  } catch (e) {
    console.log("App-level list error:", e.message);
  }

  console.log("\n==============================\n");
}

// ✅ Enable route print
// Recommended: only in development
if (process.env.NODE_ENV === "development") {
  printRoutes();
}

// If you want to ALWAYS print routes (even without NODE_ENV), use this instead:
// printRoutes();

// Start server
app.listen(appConfig.server.port, () => {
  console.log(
    `🚀 Server running at http://${appConfig.server.host}:${appConfig.server.port}${PREFIX}`
  );
});
