/**
 * Standalone worker env bootstrap — mirrors src/index.ts (dotenv + Redis subsystem).
 * Import this module first in worker entrypoints (before other local imports).
 */
import { config as loadDotenv } from "dotenv";

loadDotenv();

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
