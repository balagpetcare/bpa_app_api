/**
 * Standalone worker env bootstrap — mirrors src/index.ts (dotenv + Redis subsystem).
 * Import this module first in worker entrypoints (before other local imports).
 */
import path from "path";
import { config as loadDotenv } from "dotenv";

const projectRootEnv = path.resolve(__dirname, "../../../.env");
const cwdEnv = path.resolve(process.cwd(), ".env");

// Prefer repo-root .env (stable when systemd/pm2 cwd differs from project root).
const loaded =
  loadDotenv({ path: projectRootEnv }).parsed ||
  loadDotenv({ path: cwdEnv }).parsed ||
  loadDotenv().parsed;

if (!loaded && process.env.NODE_ENV !== "test") {
  console.warn("[WorkerEnv] No .env file loaded (checked project root and cwd)");
}

try {
  require("../../config/env");
} catch (e) {
  console.warn("[WorkerEnv] config/env load skipped", (e as Error)?.message || e);
}

try {
  const { initRedisSubsystem } = require("../../infrastructure/redis/redis.client");
  initRedisSubsystem();
} catch (e) {
  console.warn("[WorkerEnv] Redis subsystem init skipped", (e as Error)?.message || e);
}

try {
  const { bootstrapSmsProvider } = require("../../integrations/sms/smsProvider.bootstrap");
  bootstrapSmsProvider();
} catch (e) {
  console.warn("[WorkerEnv] SMS provider bootstrap skipped", (e as Error)?.message || e);
}
