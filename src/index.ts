// Single stable entrypoint for BPA API
// - Loads env via ./config/env
// - Uses the hardened Express app (src/app.ts)

const { env } = require("./config/env");
const app = require("./app");

const port = Number(env.port || process.env.PORT || 3000);
const apiPrefix = env.apiPrefix || process.env.API_PREFIX || "/api/v1";

app.listen(port, "0.0.0.0", () => {
  // Keep log format stable (used in Docker logs)
  console.log(`🚀 Server running at http://0.0.0.0:${port}${apiPrefix}`);
});

export {};
