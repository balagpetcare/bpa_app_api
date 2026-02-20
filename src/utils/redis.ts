/**
 * Redis client for policy cache, geocode cache, etc.
 * If REDIS_ENABLED=false or connection fails, callers fall back to DB / no-cache.
 * Attach error handler to avoid Unhandled error event (ECONNREFUSED when Redis not running).
 */
const Redis = require("ioredis");

const enabled = process.env.REDIS_ENABLED !== "false" && process.env.REDIS_ENABLED !== "0";

const noop = {
  get: async (): Promise<string | null> => null,
  set: async (): Promise<string> => "OK",
  del: async (): Promise<number> => 0,
};

let client: typeof noop;

if (!enabled) {
  client = noop;
} else {
  const redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: 3,
    retryStrategy: (times: number) => (times <= 3 ? 2000 : null),
  });
  redis.on("error", (err: Error) => {
    if (err?.message) console.warn("[Redis]", err.message);
  });
  client = redis;
}

module.exports = client;
export {};
